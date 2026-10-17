"""Shared execution: real SDK, scripted model, isolated business database."""
import json,os,tempfile,unittest
from unittest.mock import patch
from uuid import uuid4
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from fastapi.testclient import TestClient
from fastapi import HTTPException
from model_gateway import ModelConfig,ModelError
from app import app,db,now,FILES_DIR
from test_agent_sdk_trial import ScriptedModel
import agent_engine
class SnapshotModel(ScriptedModel):
 def _generate(self,messages,stop=None,run_manager=None,**kwargs):
  from langchain_core.messages import AIMessage
  from langchain_core.outputs import ChatResult,ChatGeneration
  sequence=[('list_selected_materials',{}),('read_material_source',{'source_index':0}),('calculate_line_totals',{'lines':[{'quantity':3,'unit_cost':'0.10'}]})]
  if self.calls<len(sequence):
   name,args=sequence[self.calls];m=AIMessage(content='',tool_calls=[{'id':str(self.calls),'name':name,'args':args,'type':'tool_call'}])
  else:m=AIMessage(content='V1，合计0.30，待人工核对。')
  self.calls+=1;return ChatResult(generations=[ChatGeneration(message=m)])
class SharedEngineTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.c=TestClient(app);token=cls.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token'];cls.headers={'Authorization':'Bearer '+token}
  with db() as c:
   c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',('engine-input','GSA02','设备资料','V1','fixture.md','test','hash','pm',now()))
   c.execute('INSERT INTO document_pages VALUES (?,?,?)',('engine-input',1,'设备数量3，单价0.10 CNY。'))
 def test_all_workspaces_use_same_sdk_without_publishing(self):
  with db() as c:before=c.execute('SELECT count(*) FROM workspace_artifacts').fetchone()[0]
  cfg=ModelConfig('zhipu','test','https://example.invalid','test')
  for stage in ['F'+str(i) for i in range(1,14)]:
   with self.subTest(stage=stage),patch('agent_engine.chat_model',return_value=SnapshotModel()),patch('agent_engine.model_config',return_value=cfg),patch('workspace_router.model_config',return_value=cfg):
    turn=uuid4().hex;r=self.c.post(f'/api/projects/GSA02/workspaces/{stage}/ask-stream',headers=self.headers,json={'question':'核对材料小计','turn_id':turn,'task_id':'materials-survey','selected_pages':[{'document_id':'engine-input','page':1}]})
    self.assertEqual(r.status_code,200,r.text);events=[json.loads(v[6:]) for v in r.text.splitlines() if v.startswith('data: ')]
    self.assertNotIn('error',[e['type'] for e in events],r.text);self.assertIn('0.30',''.join(e.get('text','') for e in events))
    with db() as c:
     row=c.execute('SELECT sources FROM workspace_replies WHERE id=?',(turn,)).fetchone();execution=next(s for s in json.loads(row[0]) if s.get('id')=='agent-execution')
     self.assertEqual([t['tool'] for t in execution['tools']],['list_selected_materials','read_material_source','calculate_line_totals'])
  with db() as c:self.assertEqual(c.execute('SELECT count(*) FROM workspace_artifacts').fetchone()[0],before)
 def test_existing_f5_software_route_uses_shared_engine(self):
  cfg=ModelConfig('zhipu','test','https://example.invalid','test')
  path=FILES_DIR/'GSA02/materials.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'spec_pages':[],'schedule':{},'phases':[],'warnings':[],'manifest':[]}))
  with patch('agent_engine.chat_model',return_value=SnapshotModel()),patch('agent_engine.model_config',return_value=cfg):
   r=self.c.post('/api/projects/GSA02/software/ask-stream',headers=self.headers,json={'question':'核对材料小计','task_id':'requirements','selected_pages':[{'document_id':'engine-input','page':1}]})
  self.assertEqual(r.status_code,200,r.text);self.assertIn('0.30',r.text);self.assertNotIn('"type": "error"',r.text)
 def test_snapshot_and_budget(self):
  sources=[{'id':'fixed','title':'清单','version':'V1','text':'旧版'}];tools={t.name:t for t in agent_engine.snapshot_tools('pm','GSA02',sources,{'days':40},[])};sources[0].update(version='V2',text='新版')
  self.assertEqual(json.loads(tools['read_material_source'].invoke({'source_index':0}))['version'],'V1')
  with self.assertRaises(ToolException):tools['read_material_source'].invoke({'source_index':-1})
  for _ in range(6):tools['get_task_parameters'].invoke({})
  with self.assertRaises(ToolException):tools['get_task_parameters'].invoke({})
 def test_permissions_and_no_publication_tools(self):
  tools=agent_engine.snapshot_tools('pm','GSA02',[],{},[]);self.assertEqual({t.name for t in tools},{'list_selected_materials','read_material_source','get_task_parameters','calculate_line_totals'})
  with patch('access_control.check_project',side_effect=HTTPException(403,'denied')):
   with self.assertRaises(HTTPException):tools[0].invoke({})
 def test_close_releases_slot(self):
  def events(*args):
   yield {'type':'delta','text':'开始'}
   raise AssertionError('closed generator must not resume')
  with patch('agent_engine.chat_model'),patch('agent_engine.stream_agent',side_effect=events):
   for _ in range(3):
    stream=agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F7',sources=[]);self.assertEqual(next(stream),'开始');stream.close()
 def test_fallback_only_before_tools_or_output(self):
  from openai import APIConnectionError
  import httpx
  cfg=ModelConfig('zhipu','test','https://example.invalid','test')
  def failure(*args):
   raise APIConnectionError(request=httpx.Request('POST','https://example.invalid'))
   yield
  def success(*args):yield {'type':'delta','text':'备用结果'}
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'test'}),patch('agent_engine.model_config',return_value=cfg),patch('agent_engine.chat_model'),patch('agent_engine.stream_agent',side_effect=[failure(),success()]) as runner:
   self.assertEqual(list(agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F7',sources=[])),['备用结果']);self.assertEqual(runner.call_count,2)
  with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'test'}),patch('agent_engine.model_config',return_value=cfg),patch('agent_engine.chat_model'),patch('agent_engine.stream_agent',side_effect=failure) as runner:
   with self.assertRaises(ModelError):list(agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F7',sources=[],trace=[{'tool':'read_material_source'}]))
   self.assertEqual(runner.call_count,1)
 def test_error_hides_provider_secret(self):
  with patch('agent_engine.chat_model',side_effect=RuntimeError('secret-key')):
   with self.assertRaises(ModelError) as caught:list(agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F7',sources=[]))
  self.assertNotIn('secret-key',str(caught.exception))
from langchain_core.tools import ToolException
if __name__=='__main__':unittest.main()
