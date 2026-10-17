"""Durable LangGraph execution behind the existing F7 SSE protocol."""
import fcntl,hashlib,json,os,sqlite3,threading
from contextlib import contextmanager
from pathlib import Path
from typing import TypedDict
from uuid import uuid4
from fastapi import Depends,HTTPException
from langgraph.graph import StateGraph,START,END
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.config import get_stream_writer
from langgraph.types import Command,interrupt
from access_control import check_owner,role_of

class State(TypedDict,total=False):
 run_id:str
 phase:str
 recipe:dict
 generated:bool
 accepted:bool

class Runtime:
 def __init__(self,db,directory):
  self.db=db;self.directory=Path(directory)/'agent-runtime';self.directory.mkdir(exist_ok=True)
  self.slots=threading.BoundedSemaphore(max(1,int(os.getenv('PRESALES_AGENT_CONCURRENCY','2'))))
  with db() as c:c.executescript('''CREATE TABLE IF NOT EXISTS runtime_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,stage_id TEXT NOT NULL,actor TEXT NOT NULL,turn_id TEXT NOT NULL,phase TEXT NOT NULL,recipe_hash TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,stage_id,actor,turn_id));''')
 def stamp(self):
  from datetime import datetime,timezone
  return datetime.now(timezone.utc).isoformat()
 def event(self,kind,**data):return 'data: '+json.dumps({'type':kind,**data},ensure_ascii=False)+'\n\n'
 def row(self,identifier,project,stage,user):
  with self.db() as c:r=c.execute('SELECT * FROM runtime_runs WHERE id=? AND project_id=? AND stage_id=? AND actor=?',(identifier,project,stage,user)).fetchone()
  if not r:raise HTTPException(404,'执行记录不存在')
  return dict(r)
 @contextmanager
 def locked(self,identifier):
  with (self.directory/(identifier+'.lock')).open('a') as lock:
   try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:raise HTTPException(409,'此任务正在执行，请稍后查看')
   try:yield
   finally:fcntl.flock(lock,fcntl.LOCK_UN)
 @contextmanager
 def graph(self,generate=None):
  connection=sqlite3.connect(self.directory/'checkpoints.sqlite3',check_same_thread=False,timeout=10)
  connection.execute('PRAGMA journal_mode=WAL')
  saver=SqliteSaver(connection)
  def validate(state):
   if state['phase'] not in {'confirm_parameters','review','complete'}:raise ValueError('invalid phase')
   return {}
  def produce(state):
   writer=get_stream_writer()
   if generate is None:raise RuntimeError('无法恢复生成步骤，请重试原请求')
   for value in generate():
    item=json.loads(value.removeprefix('data: ').strip())
    if item['type']=='error':raise RuntimeError(item.get('message','生成失败'))
    if item['type']!='done':writer(value)
   return {'generated':True}
  def approval(state):
   if state['phase']=='complete':return {'accepted':True}
   decision=interrupt({'run_id':state['run_id'],'phase':state['phase']})
   if decision is not True:raise ValueError('请确认后继续')
   return {'accepted':True}
  builder=StateGraph(State);builder.add_node('validate',validate);builder.add_node('generate',produce);builder.add_node('approval',approval)
  builder.add_edge(START,'validate');builder.add_edge('validate','generate');builder.add_edge('generate','approval');builder.add_edge('approval',END)
  try:yield builder.compile(checkpointer=saver)
  finally:connection.close()
 def update(self,identifier,status,error=''):
  with self.db() as c:c.execute('UPDATE runtime_runs SET status=?,error=?,updated_at=? WHERE id=?',(status,error[:500],self.stamp(),identifier))
 def execute(self,project,stage,user,turn,recipe,generate,phase):
  encoded=json.dumps(recipe,ensure_ascii=False,sort_keys=True)
  if len(encoded.encode())>512000:raise HTTPException(413,'本次参考内容过多，请缩小范围')
  digest=hashlib.sha256(encoded.encode()).hexdigest()
  with self.db() as c:
   c.execute('INSERT OR IGNORE INTO runtime_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)',(str(uuid4()),project,stage,user,turn,phase,digest,'queued','',self.stamp(),self.stamp()))
   row=dict(c.execute('SELECT * FROM runtime_runs WHERE project_id=? AND stage_id=? AND actor=? AND turn_id=?',(project,stage,user,turn)).fetchone())
  if row['recipe_hash']!=digest or row['phase']!=phase:raise HTTPException(409,'任务输入或规则已改变，请重新发起')
  identifier=row['id'];config={'configurable':{'thread_id':identifier},'recursion_limit':8}
  with self.locked(identifier):
   if not self.slots.acquire(blocking=False):raise HTTPException(429,'当前任务较多，请稍后重试')
   try:
    with self.graph(generate) as graph:
     state=graph.get_state(config)
     if row['status'] in {'waiting','completed'} or state.values.get('generated') and (state.next==('approval',) or not state.next):
      row['status']='waiting' if state.next else 'completed'
      self.update(identifier,row['status'])
      # Durable reply replay does not invoke the model or write another result.
      with self.db() as c:reply=c.execute('SELECT content,sources FROM workspace_replies WHERE id=? AND project_id=? AND stage_id=? AND actor=?',(turn,project,stage,user)).fetchone()
      if reply:
       snapshots=json.loads(reply['sources']);scenario=next((s.get('scenario') for s in snapshots if s.get('id')=='gsa-f7-cost-demo'),None)
       if scenario:yield self.event('scenario',data=scenario)
       yield self.event('delta',text=reply['content'])
      else:
       saved=state.values.get('recipe',{}).get('trial_id')
       with self.db() as c:trial=c.execute('SELECT output FROM flow_trials WHERE id=? AND actor=?',(saved,user)).fetchone() if saved else None
       if trial:yield self.event('delta',text=trial[0])
      yield self.event('runtime',id=identifier,phase=phase,status=row['status']);yield self.event('done');return
     self.update(identifier,'running')
     yield self.event('runtime',id=identifier,phase=phase,status='running')
     data=None if state.values else {'run_id':identifier,'recipe':recipe,'phase':phase}
     for mode,value in graph.stream(data,config,stream_mode=['custom','updates']):
      if mode=='custom':yield value
     final=graph.get_state(config);status='waiting' if final.next else 'completed';self.update(identifier,status)
     yield self.event('runtime',id=identifier,phase=phase,status=status);yield self.event('done')
   except GeneratorExit:
    self.update(identifier,'interrupted');raise
   except Exception as error:
    self.update(identifier,'failed',str(error));yield self.event('error',message=error.detail if isinstance(error,HTTPException) else str(error))
   finally:self.slots.release()
 def confirm(self,identifier,project,stage,user,phase):
  row=self.row(identifier,project,stage,user)
  if row['phase']!=phase:raise HTTPException(409,'此任务不在当前确认步骤')
  check_owner(user,project,role_of(user))
  with self.locked(identifier):
   if row['status']=='completed':return {'status':'completed'}
   with self.graph() as graph:
    config={'configurable':{'thread_id':identifier},'recursion_limit':8};state=graph.get_state(config)
    if state.next!=('approval',):raise HTTPException(409,'请先完成生成，再确认')
    if phase=='review':
     with self.db() as c:adopted=c.execute('SELECT 1 FROM workspace_artifacts WHERE project_id=? AND stage_id=? AND adopted_by=? AND source_id=?',(project,stage,user,row['turn_id'])).fetchone()
     if not adopted:raise HTTPException(409,'请先核对并采纳成果')
    graph.invoke(Command(resume=True),config);self.update(identifier,'completed')
  return {'status':'completed'}
 def finish_review(self,project,stage,user,turn):
  with self.db() as c:row=c.execute("SELECT id FROM runtime_runs WHERE project_id=? AND stage_id=? AND actor=? AND turn_id=? AND phase='review'",(project,stage,user,turn)).fetchone()
  if row:self.confirm(row[0],project,stage,user,'review')

_runtime=None
def install(app,db,directory,actor):
 global _runtime
 _runtime=Runtime(db,directory)
 @app.get('/api/projects/{project_id}/workspaces/{stage_id}/runs/{identifier}/state')
 def state(project_id:str,stage_id:str,identifier:str,user:str=Depends(actor)):
  row=_runtime.row(identifier,project_id,stage_id,user)
  return {k:row[k] for k in ['id','turn_id','phase','status','error','created_at','updated_at']}
