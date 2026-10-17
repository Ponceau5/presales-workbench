"""Shared bounded Agent execution for all workspaces; business writes stay outside tools."""
import json
import os
import threading
import time
from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException
from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain.tools import tool
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import ToolException
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
import access_control
from model_gateway import ModelError, ModelConfig, model_config
from openai import APIConnectionError, APIStatusError

def chat_model(config):
 if not config.configured:raise HTTPException(503,'请配置模型后再试运行')
 if not config.base_url.startswith('https://'):raise HTTPException(422,'模型接口必须使用HTTPS')
 extra={'reasoning_effort':'low'} if config.provider=='zhipu' and config.model.startswith('glm-5.3') else {'thinking':{'type':'disabled'}} if config.provider in {'zhipu','deepseek'} else {}
 return ChatOpenAI(model=config.model,api_key=config.api_key,base_url=config.base_url,timeout=60,max_retries=0,max_tokens=8192 if config.provider=='zhipu' and config.model.startswith('glm-5.3') else 1800,extra_body=extra,stream_usage=False,use_responses_api=False)

def stream_agent(model,tools,system_prompt,question,trace):

 agent=create_agent(model=model,tools=tools,system_prompt=system_prompt,middleware=[ModelCallLimitMiddleware(run_limit=5,exit_behavior='error')])
 answer=[];usage={'input_tokens':0,'output_tokens':0};start=time.monotonic();first=None
 for mode,data in agent.stream({'messages':[{'role':'user','content':question}]},{'recursion_limit':32,'callbacks':[]},stream_mode=['messages','updates']):
  if time.monotonic()-start>180:raise ModelError('任务超时，请缩小资料范围后重试')
  if mode=='messages':
   message,metadata=data
   if not isinstance(message,AIMessage):continue
   content=message.content
   text=content if isinstance(content,str) else ''.join(x.get('text','') for x in content if isinstance(x,dict) and x.get('type')=='text')
   if text:
    if first is None:first=round(time.monotonic()-start,3)
    answer.append(text);yield {'type':'delta','text':text}
  elif mode=='updates':
   for update in data.values():
    if not isinstance(update,dict):continue
    for message in update.get('messages',[]):
     if isinstance(message,AIMessage):
      for key in usage:usage[key]+=(message.usage_metadata or {}).get(key,0)
     if isinstance(message,ToolMessage):yield {'type':'tool','name':message.name,'status':message.status}
 if not ''.join(answer).strip():raise ModelError('模型未返回可见结果')
 yield {'type':'result','answer':''.join(answer),'tools':trace,'usage':usage,'first_text_seconds':first,'elapsed_seconds':round(time.monotonic()-start,3)}


class CostLine(BaseModel):
    quantity: Decimal = Field(ge=0, le=1000000, allow_inf_nan=False)
    unit_cost: Decimal = Field(ge=0, le=100000000, allow_inf_nan=False)


def snapshot_tools(user, project, sources, parameters, trace, stage=None):
    # Snapshots are resolved and authorized by the route before this function.
    # Never expose a filesystem path, project selector, SQL, or publication tool.
    snapshots = json.loads(json.dumps(sources, ensure_ascii=False))
    parameter_snapshot = json.loads(json.dumps(parameters, ensure_ascii=False))
    count = 0
    lock = threading.Lock()

    def guard(name):
        nonlocal count
        access_control.check_project(user, project)
        with lock:
            count += 1
            if count > 8:
                raise ToolException('工具调用达到本次上限')
            trace.append({'tool': name, 'call': count})

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
        """读取本次已确认的业务参数和 Skill 默认值，不修改参数。"""
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


_slots = threading.BoundedSemaphore(2)


def request_agent_stream(messages, *, user, project, stage, sources, parameters=None, trace=None, on_provider=None):
    """Keep existing visible-text streaming contract; do not replay tools on failure."""
    access_control.check_project(user, project)
    trace = trace if trace is not None else []
    if not _slots.acquire(blocking=False):
        raise ModelError('当前任务较多，请稍后重试')
    try:
        config = model_config()
        tools = snapshot_tools(user, project, sources, parameters or {}, trace,stage)
        system = '\n'.join(m['content'] for m in messages if m['role'] == 'system')
        system += ('\n当前工作区：' + stage + '。项目和岗位由系统绑定，不能自行切换。'
                   '提供的资料是已授权版本快照。按需使用只读工具；计算新金额时使用计算工具。'
                   '不能修改、采纳、发布、发送通知或声称已完成这些操作。工具不支持的动作交由用户确认。'
                   '不输出内部思维过程。')
        contents=[m['content'] for m in messages if m['role']!='system']
        question='\n'.join(contents) if all(isinstance(v,str) for v in contents) else [block for v in contents for block in ([{'type':'text','text':v}] if isinstance(v,str) else v)]
        received = False
        while True:
            events = None
            try:
                events = stream_agent(chat_model(config), tools, system, question, trace)
                for event in events:
                    if event['type'] == 'delta':
                        access_control.check_project(user, project)
                        received = True
                        yield event['text']
                break
            except (APIConnectionError, APIStatusError) as error:
                if getattr(error,'status_code',None)==400 and isinstance(question,list):raise ModelError('当前模型无法读取此图片输入，请切换支持图片的模型，或提供文字说明。') from None
                # Only switch before any visible output or tool side effect.
                eligible = isinstance(error, APIConnectionError) or getattr(error, 'status_code', None) in {502, 503}
                key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
                if received or trace or config.provider != 'zhipu' or not key or not eligible:
                    raise
                config = ModelConfig('deepseek', os.environ.get('DEEPSEEK_MODEL', 'deepseek-flash'),
                                     os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/'), key)
                if on_provider:
                    on_provider(config)
            finally:
                if events is not None:
                    events.close()
    except ModelError:
        raise
    except HTTPException as error:
        raise ModelError(str(error.detail)) from error
    except Exception as error:
        # Provider responses may contain sensitive details; never return raw errors.
        raise ModelError('Agent 执行失败，请检查模型配置或缩小任务后重试') from error
    finally:
        _slots.release()
