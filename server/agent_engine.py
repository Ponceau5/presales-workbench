"""Shared bounded Agent execution for all workspaces; business writes stay outside tools."""
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from functools import wraps
from contextlib import aclosing
from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException
from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware, AgentMiddleware
from langchain.agents.middleware.model_call_limit import ModelCallLimitExceededError
from langchain.tools import tool
from langchain_core.messages import AIMessage, ToolMessage, SystemMessage
from langchain_core.tools import ToolException
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
import access_control
from model_gateway import ModelError, ModelConfig, model_config, model_options
from execution_control import current, checkpoint, model_slot, sync_stream, ExecutionCancelled
import asyncio
import httpx
import contextvars
from openai import APIConnectionError, APIStatusError, APITimeoutError

def chat_model(config,json_mode=False):
 if not config.configured:raise HTTPException(503,'请配置模型后再试运行')
 if not config.base_url.startswith('https://'):raise HTTPException(422,'模型接口必须使用HTTPS')
 options=model_options(config,8192 if config.provider=='zhipu' and config.model.startswith('glm-5.3') else 1800,json_mode)
 if config.provider=='zhipu' and config.model.startswith('glm-5.3'):options['max_tokens']=8192
 response_format=options.pop('response_format',None)
 return ChatOpenAI(api_key=config.api_key,base_url=config.base_url,timeout=60,max_retries=0,stream_usage=True,use_responses_api=False,model_kwargs={'response_format':response_format} if response_format else {},http_client=httpx.Client(),http_async_client=httpx.AsyncClient(),**options)



def prepare_lli_capacity(user, project, stage, sources, parameters, trace, material_reader):
    """Calculate confirmed LLI inputs from native rows, without model transcription."""
    from bms_solution import CapacityPolicy
    if stage != 'F3' or not parameters.get('bms_capacity_policy'):
        return
    verified = next((t['normalization'] for t in reversed(trace) if t.get('normalization')), None)
    if not verified:
        return
    rows = material_reader.point_rows.get((verified['document_id'], verified['page']), [])
    source_index = next((i for i, s in enumerate(sources) if s.get('id') == verified['document_id']), None)
    if source_index is None:
        return
    zones = parameters.get('bms_allocation_zones') or {}
    rows = [r.model_copy(update={'source_index': source_index,
            'allocation_zone': zones.get(r.floor+'/'+r.room, r.allocation_zone)}) for r in rows]
    before = len(trace)
    try:
        policy = CapacityPolicy.model_validate(parameters['bms_capacity_policy'])
        calculator = next(t for t in snapshot_tools(user, project, sources, parameters, trace,
                          stage=stage, material_reader=material_reader) if t.name == 'calculate_bms_capacity')
        calculator.invoke({'rows': [r.model_dump() for r in rows], 'policy': policy.model_dump()})
    except (ValueError, ToolException) as error:
        trace.append({'tool': 'capacity_input_validation', 'invoked_by': 'input_preflight', 'error': str(error)})
    for entry in trace[before:]:
        entry['invoked_by'] = 'input_preflight'

_tool_pool=ThreadPoolExecutor(max_workers=20,thread_name_prefix='material-tool')
_tool_slots=threading.BoundedSemaphore(20)

def bounded_tool(function, timeout=30, trace=None):
 @wraps(function)
 def invoke(*args,**kwargs):
  checkpoint()
  control=current()
  if control:control.set_phase('tool:'+function.__name__)
  if not _tool_slots.acquire(blocking=False):raise ToolException('工具正在排队，请稍后重试')
  context=contextvars.copy_context()
  def work():
   started=time.monotonic();status='completed'
   try:
    checkpoint()
    result=function(*args,**kwargs)
    checkpoint()
    return result
   except BaseException:
    status='cancelled' if control and control.cancelled.is_set() else 'failed'
    raise
   finally:
    if trace is not None:trace.append({'metric':'tool','name':function.__name__,'seconds':round(time.monotonic()-started,3),'status':status})
    _tool_slots.release()
  future=_tool_pool.submit(context.run,work)
  if control:
   with control.lock:control.children.add(future)
   def finished(_):
    with control.lock:control.children.discard(future)
   future.add_done_callback(finished)
  started=time.monotonic()
  while True:
   checkpoint()
   try:return future.result(timeout=max(.001,min(.05,timeout-(time.monotonic()-started))))
   except FutureTimeout:
    if time.monotonic()-started>=timeout:
     if control:
      control.cancel('tool_timeout')
      raise ExecutionCancelled('工具处理超时，正在停止本次任务') from None
     raise ToolException('工具处理超时，本次未取得完整依据；请缩小资料范围后重试') from None
 return invoke


class FinishWithinBudget(AgentMiddleware):
 """Reserve the final allowed model call for an answer using collected evidence."""
 def __init__(self,limit):self.limit=limit
 async def awrap_model_call(self,request,handler):
  if request.state.get('run_model_call_count',0)>=self.limit-1:
   content=request.system_message.content if request.system_message else ''
   request=request.override(tools=[],tool_choice=None,system_message=SystemMessage(content=str(content)+'\n本轮资料读取已结束。现在直接输出已核对的结论、原件依据和待确认条件；若工具返回needs_input，明确列出失败方法、文件版本页码、缺失字段并向用户询问，不能声称核对完成。未取得的参数不编造、不继续请求工具。'))
  return await handler(request)

def stream_agent(model,tools,system_prompt,question,trace):
 async def run():
  for entry in tools:
   if getattr(entry,'func',None) and not getattr(entry.func,'_bounded',False):
    wrapped=bounded_tool(entry.func,trace=trace);wrapped._bounded=True
    entry.func=wrapped
    async def call(_wrapped=wrapped,**kwargs):
     return await asyncio.to_thread(_wrapped,**kwargs)
    entry.coroutine=call
   entry.handle_tool_error=True
   entry.handle_validation_error='工具参数无效，请核对原件字段和参数类型后更正；不能声称工具已成功执行。'
  limit=8 if any(t.name=='list_project_materials' for t in tools) else 5
  agent=create_agent(model=model,tools=tools,system_prompt=system_prompt,middleware=[ModelCallLimitMiddleware(run_limit=limit,exit_behavior='error'),FinishWithinBudget(limit)])
  model_calls=0
  answer=[];usage={'input_tokens':0,'output_tokens':0};start=time.monotonic();first=None
  # LangChain's async iterator propagates cancellation into the model SDK.
  async with asyncio.timeout(180):
   async with aclosing(agent.astream({'messages':[{'role':'user','content':question}]},{'recursion_limit':64},stream_mode=['messages','updates'])) as events:
    async for mode,data in events:
     checkpoint()
     if mode=='messages':
      message,metadata=data
      if not isinstance(message,AIMessage):continue
      content=message.content
      text=content if isinstance(content,str) else ''.join(x.get('text','') for x in content if isinstance(x,dict) and x.get('type')=='text')
      if text:
       if first is None:first=round(time.monotonic()-start,3)
       if current():current().set_phase('model_stream')
       answer.append(text);yield {'type':'delta','text':text}
     elif mode=='updates':
      for update in data.values():
       if not isinstance(update,dict):continue
       for message in update.get('messages',[]):
        if isinstance(message,AIMessage):
         model_calls+=1
         for key in usage:usage[key]+=(message.usage_metadata or {}).get(key,0)
         if current():current().set_phase('model_wait')
        if isinstance(message,ToolMessage):yield {'type':'tool','name':message.name,'status':message.status}
  if not ''.join(answer).strip():raise ModelError('模型未返回可见结果')
  yield {'type':'result','answer':''.join(answer),'tools':trace,'usage':usage,'model_calls':model_calls,'first_text_seconds':first,'elapsed_seconds':round(time.monotonic()-start,3)}
 async def managed():
  try:
   async with aclosing(run()) as events:
    async for item in events:yield item
  finally:
   client=getattr(model,'root_async_client',None)
   if client is not None:await client.close()
   client=getattr(model,'root_client',None)
   if client is not None:client.close()
 try:yield from sync_stream(managed())
 except TimeoutError:
  if current():current().cancel('agent_deadline')
  raise ModelError('本次生成超过3分钟，已停止。输入和已生成内容保留，可重试。') from None


class CostLine(BaseModel):
    quantity: Decimal = Field(ge=0, le=1000000, allow_inf_nan=False)
    unit_cost: Decimal = Field(ge=0, le=100000000, allow_inf_nan=False)


def snapshot_tools(user, project, sources, parameters, trace, stage=None, material_reader=None, history_reader=None):
    # Snapshots are resolved and authorized by the route before this function.
    # Never expose a filesystem path, project selector, SQL, or publication tool.
    snapshots = json.loads(json.dumps(sources, ensure_ascii=False))
    parameter_snapshot = json.loads(json.dumps(parameters, ensure_ascii=False))
    count = 0
    lock = threading.Lock()

    def guard(name):
        nonlocal count
        checkpoint()
        if current():current().set_phase('tool:'+name)
        access_control.check_project(user, project)
        with lock:
            count += 1
            if count > (16 if material_reader else 8):
                raise ToolException('工具调用达到本次上限')
            entry={'tool': name, 'call': count}
            trace.append(entry)
            return entry

    @tool
    def list_selected_materials() -> str:
        """查看当前任务已引用资料的编号、名称、版本和页码。只列本次任务的快照。"""
        guard('list_selected_materials')
        return json.dumps([
            {'source_index': i, **{k: s[k] for k in ('id', 'title', 'version', 'revision', 'page', 'purpose') if k in s}}
            for i, s in enumerate(snapshots) if s.get('text')
        ], ensure_ascii=False)

    @tool
    def read_material_source(source_index: int) -> str:
        """读取目录中 source_index 对应的已引用资料快照，不查询其他文件或新版本。模板示例不是项目事实。"""
        guard('read_material_source')
        if source_index < 0 or source_index >= len(snapshots):
            raise ToolException('资料不在本次引用范围内')
        return json.dumps(snapshots[source_index], ensure_ascii=False)

    @tool
    def get_task_parameters() -> str:
        """读取本次参数快照，包含 Skill 默认值和传入值；读取到数值不代表用户已确认，不修改参数。"""
        guard('get_task_parameters')
        return json.dumps(parameter_snapshot, ensure_ascii=False)

    @tool
    def calculate_line_totals(lines: list[CostLine]) -> str:
        """按已确认的同币种数量和单价计算金额，不编造价格或把缺价当零。"""
        guard('calculate_line_totals')
        if not 1 <= len(lines) <= 100:
            raise ToolException('只支持1至100行')
        amounts = [(r.quantity * r.unit_cost).quantize(Decimal('.01'), rounding=ROUND_HALF_UP) for r in lines]
        return json.dumps({'amounts': [str(a) for a in amounts], 'total': str(sum(amounts, Decimal('0.00')))})

    result=[list_selected_materials, read_material_source, get_task_parameters, calculate_line_totals]
    if history_reader:
        @tool
        def read_conversation_history(query: str = '', turn_id: str = '') -> str:
            """按关键字或对话轮次ID读取当前账号当前对话的已保存历史。上下文为节选时，按需回查，不猜测已省略的条件。"""
            guard('read_conversation_history')
            return json.dumps(history_reader(query,turn_id),ensure_ascii=False)
        result.append(read_conversation_history)
    if material_reader:
        @tool
        def list_project_materials(query: str = '') -> str:
            """查找当前项目全部已登记资料与完整工作表目录。未读不是缺失，输出模板不是事实。可按文件名/工作表名搜索。"""
            guard('list_project_materials')
            return json.dumps(material_reader.catalog(query), ensure_ascii=False)

        @tool
        def search_project_materials(query: str) -> str:
            """检索当前项目已授权资料，返回文件名、固定版本、页码和段落依据。未解析、索引未就绪和无命中须分别说明；冲突事实不得合并。"""
            entry=guard('search_project_materials')
            result=material_reader.search(query)
            entry['retrieval']={k:result[k] for k in ('status','hits','unavailable')}
            return json.dumps(result,ensure_ascii=False)

        @tool
        def read_project_material(document_id: str, page: int, start_row: int = 1, row_count: int = 30, query: str = '') -> str:
            """从当前项目原件读取指定工作表/页；Excel保留列字母和原行号、展开合并单元格。按next_row继续，可用query查找完整表中的行。最多80行，不把局部未见当成整表没有。"""
            entry=guard('read_project_material')
            result = material_reader.read(document_id, page, start_row, row_count, query)
            entry['read'] = {k: result[k] for k in ('document_id','version','page','sheet','next_row','range_complete') if k in result}
            return json.dumps(result, ensure_ascii=False, default=str)

        @tool
        def read_project_configuration(document_id: str, page: int) -> str:
            """按原件唯一的设备名、型号和数量列提取整张现有配置表，保留原单元格。多数量列时拒绝猜测。只是原配置记录，不是已确认新选型，不含价格。"""
            entry=guard('read_project_configuration')
            result=material_reader.configuration(document_id,page)
            if result.get('status')=='needs_input':
                entry['extraction_failure']={k:v for k,v in result.items() if k!='fallback'}
                return json.dumps(result,ensure_ascii=False,default=str)
            entry['configuration']=result
            return json.dumps(result,ensure_ascii=False,default=str)

        @tool
        def normalize_project_points(document_id: str, page: int) -> str:
            """完整读取原始Excel中可识别的房间四类IO汇总，由程序按原列提取并归一化，保留单元格来源。不把串口/网口数量当设备台数；不选硬件，不确认共享区域。遇到无法识别表头则停止，不猜测。"""
            entry=guard('normalize_project_points')
            result = material_reader.normalize(document_id, page)
            if result.get('status')=='needs_input':
                entry['extraction_failure']={k:v for k,v in result.items() if k!='fallback'}
                return json.dumps(result,ensure_ascii=False,default=str)
            entry['normalization'] = result
            summary={k:v for k,v in result.items() if k not in {'rows','source_cells','existing_port_columns','hli'}}
            summary['hli_summary']=[{k:g[k] for k in ('device','transport','quantity_column','known_quantity','control_totals')} for g in result.get('hli',{}).get('groups',[])]
            summary['rows_preview']=result['source_cells'][:12]
            summary['existing_port_preview']=result['existing_port_columns'][:4]
            summary['output']='系统会呈现全部归一化行及原表合计核对；请简要说明范围和待确认事项，不重写完整数量表。'
            return json.dumps(summary, ensure_ascii=False)

        result += [list_project_materials, search_project_materials, read_project_material, read_project_configuration, normalize_project_points]
    if stage in {'F2', 'F3', 'F4'}:
        from bms_solution import PointRow, CapacityPolicy, normalize_points, calculate_capacity

        def validate_bms_sources(rows):
            for row in rows:
                if row.source_index >= len(snapshots):
                    raise ToolException('点表来源不在本次引用范围内')
                source = snapshots[row.source_index]
                if not source.get('text') or source.get('purpose', 'input') != 'input':
                    raise ToolException('点表计算必须引用已读项目输入，不能使用目录或输出模板示例')

        @tool
        def read_bms_rules() -> str:
            """读取 BMS 点表口径、待确认经验容量和规则冲突。候选值不是厂家标准或本项目已确认参数。"""
            guard('read_bms_rules')
            from pathlib import Path
            return (Path(__file__).parent / 'skills/bms-rules.json').read_text()

        @tool
        def normalize_bms_points(rows: list[PointRow]) -> str:
            """归一化已读点表的结构化行。明确楼层、房间、分配区域、位号、接口、数量和来源；LLI 四类通道必须显式提供，未知用 null。仅合并完全相同的位号行，冲突保留待确认。不读取任意文件。"""
            guard('normalize_bms_points')
            validate_bms_sources(rows)
            try:
                return json.dumps(normalize_points(rows), ensure_ascii=False)
            except ValueError as error:
                raise ToolException(str(error)) from None

        result += [read_bms_rules] + ([] if material_reader else [normalize_bms_points])
        if stage in {'F3', 'F4'}:
            @tool
            def calculate_bms_capacity(rows: list[PointRow], policy: CapacityPolicy) -> str:
                """按已确认项目规则计算各分配区域的串口链、网关、IO模块、PLC槽位下限与交换机端口下限，返回公式和来源。先确认容量、每串上限、预留及网络额外端口；不确定的区域阻断。不能计算 iPAC 混合扩展、柜数、线缆或服务器。"""
                entry=guard('calculate_bms_capacity')
                validate_bms_sources(rows)
                if material_reader:
                    confirmed=parameter_snapshot.get('bms_capacity_policy')
                    try:confirmed=CapacityPolicy.model_validate(confirmed).model_dump() if confirmed else None
                    except ValueError:confirmed=None
                    if confirmed != policy.model_dump():
                        raise ToolException('本次用户输入尚未确认这套容量参数，不能由模型自行确认或用经验值计算')
                    if parameter_snapshot.get('bms_capacity_scope')!='lli_only':
                        raise ToolException('当前归一化仅含房间硬点汇总；需用户确认仅校核LLI范围，HLI台数不能由串口数代替')
                    material_reader.validate_rows(rows,snapshots,parameter_snapshot.get('bms_allocation_zones'))
                try:
                    calculation = calculate_capacity(rows, policy)
                    if material_reader:
                        calculation['scope']='仅已确认的LLI硬接线IO与CPU扩展槽位下限；未计算HLI网关、串口链和完整网络'
                        for zone in calculation['zones']:
                            for key in ('serial_chains','gateway_count','ethernet_ports','switch_count_lower_bound'):zone[key]=None
                            zone.get('formulas',{}).pop('gateway',None);zone.get('formulas',{}).pop('switch',None)
                    entry["calculation"] = calculation
                    return json.dumps(calculation, ensure_ascii=False)
                except ValueError as error:
                    raise ToolException(str(error)) from None
            result.append(calculate_bms_capacity)
    if stage=='F5':
        @tool
        def calculate_server_resources(point_count:int,sampling_seconds:float,retention_years:float,device_count:int,cache_days:float,backup_copies:int,raid_usable_ratio:float,headroom:float,inputs_confirmed:bool)->str:
            """按已确认测点数和参数计算当前范围的服务器存储需求。参数缺失先询问，不沿用其他项目规模。不验证 CPU/内存性能。"""
            guard('calculate_server_resources')
            if not inputs_confirmed:raise ToolException('请先请用户确认接入范围、采样周期及存储假设')
            from sizing_tools import SizingInputs,calculate_server_sizing
            value=SizingInputs(scope='custom',point_low=point_count,point_high=point_count,device_count=device_count,sampling_seconds=sampling_seconds,retention_years=retention_years,cache_days=cache_days,backup_copies=backup_copies,raid_usable_ratio=raid_usable_ratio,headroom=headroom,scope_note='来自当前任务已确认输入',sampling_confirmed=True,scope_confirmed=True,assumptions_confirmed=True)
            return json.dumps(calculate_server_sizing(value,{}),ensure_ascii=False)
        result.append(calculate_server_resources)
    return result



def request_agent_stream(messages, *, user, project, stage, sources, parameters=None, trace=None, on_provider=None, json_mode=False, material_reader=None, allow_tools=True, read_only=False, history_reader=None):
    """Keep existing visible-text streaming contract; do not replay tools on failure."""
    started=time.monotonic();config=None
    access_control.check_project(user, project)
    trace = trace if trace is not None else []
    admission=model_slot()
    admission.__enter__()
    trace.append({'metric':'queue','seconds':round(time.monotonic()-started,3)})
    try:
        config = model_config()
        tools = [] if stage=="SKILL" or not allow_tools else snapshot_tools(user, project, sources, parameters or {}, trace,stage,material_reader,history_reader)
        if read_only:tools=[t for t in tools if t.name in {"list_selected_materials","read_material_source","get_task_parameters","list_project_materials","search_project_materials","read_project_material","read_conversation_history"}]
        system = '\n'.join(m['content'] for m in messages if m['role'] == 'system')
        system += ('\n当前工作区：' + stage + '。项目和岗位由系统绑定，不能自行切换。'
                   '提供的资料是已授权版本快照。按需使用只读工具；计算新金额时使用计算工具。'
                   '不能修改、采纳、发布、发送通知或声称已完成这些操作。工具不支持的动作交由用户确认。'
                   '上下文或资料标记为节选时，先按需检索和读取，不能猜测已省略的条件。已提供足够依据时不要为复述同一内容重复读全文。\n不输出内部思维过程。资料事实必须附文件名、固定版本及页码或行号；检索命中可引用段落号。输出模板仅作格式参考，未读、无命中、未解析和索引未就绪分别说明，不把相互冲突的事实擅自合并。')
        if material_reader and allow_tools:
            system += ('\n必须先用list_project_materials查完整目录，按需用read_project_material读原表，不能将未读到写成缺失。'
                       '工具返回needs_input后，停止对同一资料同一工作表的结构化尝试，直接询问required_input。不同工作表仍可正常核对。F3点表类入口先调用normalize_project_points；F4配置入口用read_project_configuration读取唯一列映射的原清单（可从工作表目录选择BMS等配置表），不从组屏片段猜数量。'
                       '点表归一化只能使用normalize_project_points提取的原单元格数值；串口链/网口/柜数不是设备台数。'
                       '任何数量、型号、列名必须对上原件单元格；重复列按列字母区分，不从文本节选猜列。'
                       '缺项目确认的容量参数、分配区域或有效手册时，禁止手算或判断模块不足/足够、选型合格；只整理原设计和待确认项。'
                       'CPU自带IO与扩展模块必须分开，不漏计也不重复计算，预留口径未经确认不叠加。'
                       '只有calculate_bms_capacity成功才可输出新的容量结论；原表配置数可引用但不是新设计已校核。')
        if material_reader and not allow_tools:
            system += '\n本次输入已由系统从原件完成确定性提取并附上完整目录、版本和校核结果。不要请求不存在的工具；只简短核对范围与未确认条件，不重写数量表、不开出新型号、不手算容量结论。'
        contents=[m['content'] for m in messages if m['role']!='system']
        question='\n'.join(contents) if all(isinstance(v,str) for v in contents) else [block for v in contents for block in ([{'type':'text','text':v}] if isinstance(v,str) else v)]
        received = False
        retries = 0
        while True:
            events = None
            try:
                events = stream_agent(chat_model(config,json_mode=json_mode), tools, system, question, trace)
                for event in events:
                    if event['type'] == 'result':
                        trace.append({'metric':'model','model_calls':event.get('model_calls',0),'usage':event.get('usage',{}),'first_text_seconds':event.get('first_text_seconds'),'elapsed_seconds':event.get('elapsed_seconds')})
                    if event['type'] == 'delta':
                        access_control.check_project(user, project)
                        received = True
                        yield event['text']
                break
            except (APIConnectionError, APIStatusError) as error:
                if isinstance(error,APITimeoutError):
                    raise ModelError('生成中断：等待后续内容超时，已保存输入可安全重试' if received else '首段内容等待超时，已保存输入可安全重试') from None
                status=getattr(error,'status_code',None)
                body=getattr(error,'body',{}) or {}
                error_body=body.get('error',body) if isinstance(body,dict) else {}
                raw_code=error_body.get('code','') if isinstance(error_body,dict) else ''
                code=str(raw_code)[:80]
                # Keep status and quota code, never request headers or response text.
                trace.append({'metric':'provider_error','http_status':status,
                              'code':code if re.fullmatch(r'[A-Za-z0-9_.-]{0,80}',code) else ''})
                if status in {429,503} and not received and not any('tool' in entry for entry in trace) and retries < 1:
                    body=getattr(error,'body',{}) or {}
                    code=str(body.get('code','')) if isinstance(body,dict) else ''
                    if code!='1113':
                        retries+=1
                        if current():current().cancelled.wait(.5);checkpoint()
                        else:time.sleep(.5)
                        trace.append({'metric':'retry','reason':'rate_limit' if status==429 else 'service_unavailable','count':1})
                        continue
                if status==503:raise ModelError('模型服务暂不可用（503），请稍后重试；未生成正式成果') from None

                if getattr(error,'status_code',None)==429:
                    raise ModelError('模型服务商当前限流或并发额度不足，请稍后重试；已完成内容仍保留。') from None
                if getattr(error,'status_code',None)==400 and isinstance(question,list):raise ModelError('当前模型无法读取此图片输入，请切换支持图片的模型，或提供文字说明。') from None
                # Only switch before any visible output or tool side effect.
                eligible = isinstance(error, APIConnectionError) or getattr(error, 'status_code', None) in {502, 503}
                key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
                if received or any('tool' in entry for entry in trace) or config.provider != 'zhipu' or not key or not eligible:
                    raise ModelError('网络连接中断，已保存输入可安全重试' if isinstance(error,APIConnectionError) else '模型请求失败，请稍后重试') from None
                trace.append({'metric':'retry','reason':'provider_unavailable','count':1})
                config = ModelConfig('deepseek', os.environ.get('DEEPSEEK_MODEL', 'deepseek-flash'),
                                     os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/'), key)
                if on_provider:
                    on_provider(config)
            finally:
                if events is not None:
                    events.close()
    except ModelCallLimitExceededError as error:
        failure=ModelError('本次处理反复读取资料，达到执行次数上限，已停止。请按具体资料继续核对。')
        if current():current().fail(failure)
        raise failure from error
    except ModelError as error:
        if current():current().fail(error)
        raise
    except HTTPException as error:
        raise ModelError(str(error.detail)) from error
    except Exception as error:
        logging.getLogger(__name__).warning('Model generation failed: type=%s status=%s elapsed=%.1fs',type(error).__name__,getattr(error,'status_code',None),time.monotonic()-started)
        # Provider responses may contain sensitive details; never return raw errors.
        failure=ModelError('Agent 执行失败，请检查模型配置或缩小任务后重试')
        if current():current().fail(failure)
        raise failure from error
    finally:
        logging.getLogger(__name__).info('Model generation finished: provider=%s model=%s elapsed=%.1fs tools=%d',getattr(config,'provider','unknown'),getattr(config,'model','unknown'),time.monotonic()-started,len(trace))
        admission.__exit__(None,None,None)
