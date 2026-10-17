"""SDK-neutral business tools and deterministic fault tests; no production writes."""
import asyncio,json,os,sys,time,resource,threading,zipfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from typing import Annotated
from pydantic import Field,BaseModel
from importlib.metadata import version
os.environ['PYDANTIC_AI_NO_BANNER']='1'
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['PRESALES_SDK_RESULTS']);OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'server'))
SDK,CASE=sys.argv[1:3];MODE=sys.argv[3] if len(sys.argv)>3 else 'control'
class CostInput(BaseModel):
 person_days:int=Field(default=40,ge=0,le=10000)
class Review(BaseModel):
 person_days:int=Field(ge=0)
 version:str
 missing:list[str]
class Business:
 def __init__(self):self.trace=[];self.entered=[];self.artifacts=[];self.started=asyncio.Event();self.snapshot=None;self.reads=0
 def tools(self):
  async def read_input(project_id:str='GSA02')->str:
   """Read permitted project input, latest version V2; other project IDs are forbidden."""
   self.trace.append('read_input');self.reads+=1
   if project_id!='GSA02':return json.dumps({'error':'FORBIDDEN','project_id':project_id})
   if CASE in ['tool_error','tool_recovery'] and self.reads==1:raise OSError('temporary input read failure')
   return json.dumps({'project':'GSA02','stage':CASE if CASE in ['F5','F8'] else 'F7','version':'V2','materials_cost':195,'defaults':{'person_days':40,'daily_labor':1600,'country':'Thailand'},'external_procurement':False})
  async def calculate_cost(parameters:CostInput)->str:
   """Calculate demo cost from approved defaults. person_days must be nonnegative. Missing prices are not zero."""
   person_days=CostInput.model_validate(parameters).person_days
   self.trace.append('calculate_cost');self.entered.append(person_days)
   from f7_project_demo import calculate,CostParameters
   data={'source':'SDK-V2','scope_note':'Controlled test, no procurement','crm':[{'sku':'A','qty':6,'costUnit':12.5},{'sku':'B','qty':4,'costUnit':30}]}
   self.snapshot=calculate(data,CostParameters(person_days=person_days));return json.dumps({'version':'V2','person_days':person_days,'cost':self.snapshot['totals']['cost']})
  async def export_excel()->str:
   """Export computed cost into the ORIGINAL seven-sheet Excel template; calculate_cost must run first."""
   self.trace.append('export_excel')
   if self.snapshot is None:return '{"error":"calculate first"}'
   from f7_project_demo import export_original_template
   path=OUT/(SDK+'-'+CASE+'-'+MODE+'.xlsx');path.write_bytes(export_original_template(self.snapshot,1));self.artifacts.append(str(path));return json.dumps({'file':path.name,'version':'V2','cost':self.snapshot['totals']['cost']})
  async def slow_export()->str:
   """Simulate a cancellable operation. Does not create any artifact before completion."""
   self.trace.append('slow_export');self.started.set();await asyncio.sleep(5);self.artifacts.append('unexpected-finished');return 'finished'
  return [read_input,calculate_cost,export_excel,slow_export]
biz=Business();requests=[]
class Gateway(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  global output_attempts
  payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])));requests.append(payload)
  if CASE=='http_error':
   self.send_response(503);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"message":"controlled unavailable","type":"server_error"}}');return
  calls=sum(len(m.get('tool_calls',[])) for m in payload['messages'] if m['role']=='assistant')
  sequence=[('read_input',{}),('calculate_cost',{'parameters':{'person_days':40}}),('export_excel',{})]
  if CASE=='validation':sequence=[('calculate_cost',{'parameters':{'person_days':-1}}),('calculate_cost',{'parameters':{'person_days':40}})]
  elif CASE in ['tool_error','tool_recovery']:sequence=[('read_input',{}),('read_input',{})]
  elif CASE=='scope':sequence=[('read_input',{'project_id':'OTHER-PROJECT'})]
  elif CASE=='cancel':sequence=[('slow_export',{})]
  elif CASE=='limit':sequence=[('read_input',{})]*20
  elif CASE in ['F5','F8']:sequence=[('read_input',{})]
  if calls<len(sequence):
   name,args=sequence[calls];delta={'tool_calls':[{'index':0,'id':'call_'+str(calls),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]};finish='tool_calls'
  else:delta={'content':'Completed V2.'};finish='stop'
  if CASE=='structured':
   extra_tools=[t['function']['name'] for t in payload.get('tools',[]) if t['function']['name'] not in ['read_input','calculate_cost','export_excel','slow_export']]
   if extra_tools:
    output_attempts+=1
    delta={'tool_calls':[{'index':0,'id':'output_'+str(output_attempts),'type':'function','function':{'name':extra_tools[0],'arguments':json.dumps({'person_days':-1 if output_attempts==1 else 40,'version':'V2','missing':[]})}}]};finish='tool_calls'
   else:delta={'content':'Completed V2.'};finish='stop'
  self.send_response(200);self.send_header('Content-Type','text/event-stream' if payload.get('stream') else 'application/json');self.end_headers()
  try:
   if payload.get('stream'):
    for d,f in [({'role':'assistant'},None),(delta,None),({},finish)]:
     chunk={'id':'test','object':'chat.completion.chunk','created':1,'model':'test-model','choices':[{'index':0,'delta':d,'finish_reason':f}]}
     self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode());self.wfile.flush()
    self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
   else:
    msg={'role':'assistant','content':delta.get('content')}
    if 'tool_calls' in delta:msg['tool_calls']=[{k:v for k,v in c.items() if k!='index'} for c in delta['tool_calls']]
    self.wfile.write(json.dumps({'id':'test','object':'chat.completion','created':1,'model':'test-model','choices':[{'index':0,'message':msg,'finish_reason':finish}],'usage':{'prompt_tokens':10,'completion_tokens':10,'total_tokens':20}}).encode())
  except (BrokenPipeError,ConnectionResetError):pass
output_attempts=0
server=None
if MODE=='control':
 server=ThreadingHTTPServer(('127.0.0.1',0),Gateway);threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)+'/v1';key='local-test';model='test-model';extra={}
else:
 for raw in (ROOT/'.env.local').read_text().splitlines():
  if '=' in raw and not raw.lstrip().startswith('#'):
   k,v=raw.split('=',1)
   if k.strip().startswith('ZHIPU_'):os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))
 base=os.environ.get('ZHIPU_BASE_URL','https://open.bigmodel.cn/api/paas/v4');key=os.environ['ZHIPU_API_KEY'];model=os.environ.get('ZHIPU_MODEL','glm-5.3-flash');extra={'reasoning_effort':'low'}
skill='You are a presales business assistant. This is an authorized demo. Defaults are approved; use person_days 40 without asking. Use read_input, calculate_cost, then export_excel. Do not publish or notify. Do not invent missing prices. Only use current project. Return version, cost, and filename. Tool failures must never be represented as success.'
if CASE=='skill_change':skill+=' The personal Skill draft overrides person_days to 50. Use 50, not 40.'
if CASE=='missing':skill='Project input has no procurement cost. Do not invent prices, do not calculate/export. Read inputs and report missing procurement quote.'
question='Generate the demo cost Excel using Skill defaults.'
if CASE in ['F5','F8']:question='Read permitted input for workspace '+CASE+' and return the version; do not calculate or export.';skill=question
functions=biz.tools();answer=[];events=[];structured=None
# Live runs use the same flat schema for every SDK, excluding provider-specific nested-schema handling.
if MODE=='live':
 original_calculate=functions[1]
 async def calculate_cost(person_days:int=40)->str:
  """Calculate using approved defaults; person_days is 40 unless the Skill overrides it."""
  return await original_calculate(CostInput(person_days=person_days))
 functions[1]=calculate_cost
def make_runner():
 if SDK=='langchain':
  from langchain.agents import create_agent
  from langchain.agents.middleware import ModelCallLimitMiddleware
  from langchain.tools import tool
  from langchain_openai import ChatOpenAI
  from langchain_core.messages import AIMessage
  middleware=[ModelCallLimitMiddleware(run_limit=5,exit_behavior='error')]
  if CASE=='tool_recovery':
   from langchain.agents.middleware import wrap_tool_call
   from langchain_core.messages import ToolMessage
   @wrap_tool_call
   async def recover_read(request,handler):
    try:return await handler(request)
    except OSError:
     if request.tool_call['name']!='read_input':raise
     return ToolMessage(content='Temporary read failure; retry read_input.',tool_call_id=request.tool_call['id'],name='read_input',status='error')
   middleware.append(recover_read)
  from langchain.agents.structured_output import ToolStrategy
  agent=create_agent(model=ChatOpenAI(model=model,api_key=key,base_url=base,max_tokens=8192,timeout=10 if MODE=='control' else 60,max_retries=0,extra_body=extra,use_responses_api=False),tools=[tool(f) for f in functions],system_prompt=skill,middleware=middleware,**({'response_format':ToolStrategy(Review)} if CASE=='structured' else {}))
  async def run():
   global structured
   async for mode,value in agent.astream({'messages':[{'role':'user','content':question}]},{'recursion_limit':40},stream_mode=['messages','updates']):
    events.append(mode)
    if mode=='updates':
     for v in value.values():
      if isinstance(v,dict) and isinstance(v.get('structured_response'),Review):structured=v['structured_response'].model_dump()
    if mode=='messages' and isinstance(value[0],AIMessage) and isinstance(value[0].content,str):answer.append(value[0].content)
  return run
 if SDK=='pydantic':
  from pydantic_ai import Agent,UsageLimits
  from pydantic_ai.models.openai import OpenAIChatModel
  from pydantic_ai.providers.openai import OpenAIProvider
  from openai import AsyncOpenAI
  from pydantic_ai.messages import PartStartEvent,PartDeltaEvent,TextPart,TextPartDelta
  if CASE=='tool_recovery':
   from pydantic_ai import ModelRetry
   original=functions[0]
   async def read_input(project_id:str='GSA02')->str:
    """Read permitted input; a temporary error can be retried."""
    try:return await original(project_id)
    except OSError:raise ModelRetry('Temporary read failure; retry read_input.')
   functions[0]=read_input
  agent=Agent(OpenAIChatModel(model,provider=OpenAIProvider(openai_client=AsyncOpenAI(base_url=base,api_key=key,max_retries=0))),instructions=skill,tools=functions,output_type=Review if CASE=='structured' else str,model_settings={'max_tokens':8192,'timeout':10 if MODE=='control' else 60,'extra_body':extra})
  async def run():
   global structured
   async with agent.iter(question,usage_limits=UsageLimits(request_limit=5,tool_calls_limit=8)) as r:
    async for node in r:
     if Agent.is_model_request_node(node):
      async with node.stream(r.ctx) as stream:
       async for e in stream:
        events.append(type(e).__name__)
        if isinstance(e,PartStartEvent) and isinstance(e.part,TextPart):answer.append(e.part.content)
        if isinstance(e,PartDeltaEvent) and isinstance(e.delta,TextPartDelta):answer.append(e.delta.content_delta)
    if r.result and isinstance(r.result.output,Review):structured=r.result.output.model_dump()
  return run
 from strands import Agent,tool
 from strands.models.openai import OpenAIModel
 agent=Agent(model=OpenAIModel(client_args={'api_key':key,'base_url':base,'timeout':10 if MODE=='control' else 60,'max_retries':0},model_id=model,params={'max_tokens':8192,'extra_body':extra}),tools=[tool(f) for f in functions],system_prompt=skill,callback_handler=None,retry_strategy=None,structured_output_model=Review if CASE=='structured' else None)
 async def run():
  global structured
  async for e in agent.stream_async(question,limits={'turns':5}):
   events.extend(e.keys())
   if 'result' in e and isinstance(e['result'].structured_output,Review):structured=e['result'].structured_output.model_dump()
   if e.get('data'):answer.append(e['data'])
 return run
async def main():
 start=time.monotonic();error=None;cancel_time=None
 try:
  run=make_runner()
  if CASE=='cancel':
   task=asyncio.create_task(run());await asyncio.wait_for(biz.started.wait(),5);when=time.monotonic();task.cancel()
   try:await asyncio.wait_for(task,1)
   except asyncio.CancelledError:pass
   cancel_time=round(time.monotonic()-when,3)
  else:await asyncio.wait_for(run(),90 if MODE=='live' else 12)
 except Exception as e:
  import traceback
  error=type(e).__name__
  diagnostic=[{'file':Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(e.__traceback__)[-5:]]
  (OUT/(SDK+'-'+CASE+'-diagnostic.json')).write_text(json.dumps(diagnostic))
 checks={};text=''.join(answer)
 if CASE=='structured':checks={'typed_output':structured is not None,'valid_after_retry':bool(structured and structured['person_days']==40),'invalid_was_rejected':output_attempts==2}
 elif CASE in ['full','skill_change']:
  checks['tool_sequence']=biz.trace[:3]==['read_input','calculate_cost','export_excel'];checks['days']=biz.entered==[50 if CASE=='skill_change' else 40];checks['artifact']=len(biz.artifacts)==1
  if biz.artifacts:
   with zipfile.ZipFile(ROOT/'public/overseas-cost-template.xlsx') as original,zipfile.ZipFile(biz.artifacts[0]) as output:
    checks['styles_preserved']=original.read('xl/styles.xml')==output.read('xl/styles.xml');checks['zip_entries_preserved']=set(original.namelist())==set(output.namelist());checks['worksheet_count']=len([n for n in output.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')])==7
    from xml.etree import ElementTree as ET
    ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    expected=129084.87 if CASE=='skill_change' else 106115.87
    total=ET.fromstring(output.read('xl/worksheets/sheet1.xml')).find("s:sheetData/s:row/s:c[@r='F50']/s:v",ns)
    checks['correct_total']=abs(self_total-expected)<0.001 if (self_total:=biz.snapshot['totals']['cost']) is not None else False
    checks['excel_total_cache']=total is not None and abs(float(total.text)-expected)<0.001
    checks['sheet_names_preserved']=[e.attrib['name'] for e in ET.fromstring(original.read('xl/workbook.xml')).find('s:sheets',ns)]==[e.attrib['name'] for e in ET.fromstring(output.read('xl/workbook.xml')).find('s:sheets',ns)]
    for feature in ['mergeCells','cols','pageMargins','pageSetup','drawing']:
     checks[feature+'_preserved']=all(ET.tostring(ET.fromstring(original.read(n)).find('s:'+feature,ns))==ET.tostring(ET.fromstring(output.read(n)).find('s:'+feature,ns)) if ET.fromstring(original.read(n)).find('s:'+feature,ns) is not None else ET.fromstring(output.read(n)).find('s:'+feature,ns) is None for n in output.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'))
 elif CASE=='validation':checks={'invalid_never_entered':-1 not in biz.entered,'recovered':biz.entered==[40] and error is None}
 elif CASE in ['tool_error','tool_recovery']:checks={'recovered':biz.reads==2 and error is None,'no_false_export':not biz.artifacts}
 elif CASE=='http_error':checks={'stopped_safely':error is not None and not biz.trace,'no_hidden_retry':len(requests)==1}
 elif CASE=='scope':checks={'no_foreign_data':not any('materials_cost' in str(m.get('content','')) for req in requests for m in req['messages'] if m['role']=='tool'),'no_export':not biz.artifacts}
 elif CASE=='cancel':checks={'cancelled':cancel_time is not None and cancel_time<1,'no_export':not biz.artifacts,'no_false_answer':not text}
 elif CASE=='limit':checks={'bounded':len(requests)<=5,'no_false_answer':not text,'no_export':not biz.artifacts}
 elif CASE in ['F5','F8']:checks={'read_only':biz.trace==['read_input'],'no_export':not biz.artifacts}
 result={'sdk':SDK,'case':CASE,'mode':MODE,'passed':bool(checks) and all(checks.values()),'checks':checks,'trace':biz.trace,'entered':biz.entered,'requests':len(requests) if MODE=='control' else None,'error_type':error,'answer':text,'structured':structured,'output_attempts':output_attempts,'cancel_seconds':cancel_time,'elapsed_seconds':round(time.monotonic()-start,3),'peak_mb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024/1024,1),'sdk_version':version({'langchain':'langchain','pydantic':'pydantic-ai-slim','strands':'strands-agents'}[SDK])}
 (OUT/(SDK+'-'+CASE+'-'+MODE+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
asyncio.run(main())
if server:server.shutdown()
