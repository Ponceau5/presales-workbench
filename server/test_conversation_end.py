import os,tempfile,json,unittest,uuid
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from fastapi.testclient import TestClient
from app import app,db
from execution_control import Task,bind,ExecutionCancelled
class ConversationEndTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  self.base='/api/projects/GSA02/workspaces/F1'
 def test_close_keeps_partial_history_and_late_save_cannot_reopen(self):
  identifier=uuid.uuid4().hex;value={'started':True,'conversationId':identifier,'turns':[{'id':'old','question':'旧问题','answer':'部分回复','status':'running'}]}
  response=self.c.post(self.base+'/dialogues/'+identifier+'/close',headers=self.h,json={'value':value})
  self.assertEqual(response.status_code,200,response.text)
  response=self.c.post(self.base+'/state',headers=self.h,json={'expected_revision':0,'value':{'current':value}})
  self.assertEqual(response.status_code,200,response.text)
  saved=self.c.get(self.base+'/dialogues/'+identifier,headers=self.h).json()
  self.assertTrue(saved.get('ended_at'));self.assertEqual(saved['turns'][0]['status'],'stopped');self.assertEqual(saved['turns'][0]['answer'],'部分回复')
  restored=self.c.get(self.base+'/state',headers=self.h).json()['value']['current']
  self.assertNotEqual(restored['conversationId'],identifier);self.assertEqual(restored['turns'],[]);self.assertFalse(restored['started'])
 def test_close_does_not_end_other_account_history(self):
  identifier=uuid.uuid4().hex
  with db() as c:c.execute('INSERT INTO workspace_dialogues VALUES (?,?,?,?,?,?)',('GSA02','F1','sales',identifier,json.dumps({'turns':[{'question':'private'}]}),'now'))
  self.c.post(self.base+'/dialogues/'+identifier+'/close',headers=self.h,json={'value':{'turns':[]}})
  with db() as c:other=json.loads(c.execute('SELECT value FROM workspace_dialogues WHERE actor=? AND id=?',('sales',identifier)).fetchone()[0])
  self.assertNotIn('ended_at',other);self.assertEqual(other['turns'][0]['question'],'private')
 def test_tool_timeout_reason_survives_cancellation_and_finish(self):
  t=Task('pm','GSA02','F1',uuid.uuid4().hex)
  with bind(t):
   t.start();t.set_phase('tool:read_material_source');t.cancel('tool_timeout')
   with self.assertRaises(ExecutionCancelled) as e:t.check()
   self.assertIn('30秒',str(e.exception));t.finish()
  with db() as c:row=c.execute('SELECT status,error,admitted FROM model_tasks WHERE id=?',(t.id,)).fetchone()
  self.assertEqual(row['status'],'cancelled');self.assertIn('30秒',row['error']);self.assertEqual(row['admitted'],0)

 def test_missing_workflow_input_is_guidance_not_execution_error(self):
  from unittest.mock import patch
  from model_gateway import ModelConfig
  project='EMPTY-'+uuid.uuid4().hex[:8]
  self.assertEqual(self.c.post('/api/access/projects',headers=self.h,json={'id':project,'name':project}).status_code,200)
  base=f'/api/projects/{project}/workspaces/F1'
  flow=self.c.get(base+'/flows',headers=self.h).json()
  definition=flow['active']['definition'];definition['tasks'][0]['require_sources']=True
  saved=self.c.post(base+'/flows/draft',headers=self.h,json={'definition':definition,'expected_revision':0,'base_version_id':flow['active']['id']})
  self.assertEqual(saved.status_code,200,saved.text)
  with patch('workspace_router.model_config',return_value=ModelConfig('deepseek','fixture','https://fixture.invalid','fixture')):
   response=self.c.post(base+'/ask-stream',headers=self.h,json={'question':'检查输入','test_run':True,'flow_draft_id':saved.json()['id'],'task_id':definition['tasks'][0]['id'],'conversation_id':'missing','turn_id':uuid.uuid4().hex})
  self.assertIn('"type": "prompt"',response.text,response.text);self.assertNotIn('"type": "error"',response.text)
  with db() as c:
   trial=c.execute('SELECT status FROM flow_trials WHERE project_id=?',(project,)).fetchone()
  self.assertEqual(trial['status'],'needs_input')

 def test_startup_immediately_recovers_dead_worker_without_new_request(self):
  import execution_control as control
  from fastapi import FastAPI
  task=Task('pm','GSA02','F1',uuid.uuid4().hex);task.start()
  with db() as c:c.execute('UPDATE model_tasks SET owner=?,admitted=1 WHERE id=?',(999999999,task.id))
  control._active.pop(task.id,None)
  control.install(FastAPI(),db,lambda:'pm')
  with db() as c:row=c.execute('SELECT status,admitted FROM model_tasks WHERE id=?',(task.id,)).fetchone()
  self.assertEqual(tuple(row),('interrupted',0))

 def test_browser_timeout_reason_is_preserved_by_cancel_api(self):
  task=Task('pm','GSA02','F1',uuid.uuid4().hex);task.start()
  try:
   response=self.c.post('/api/model-tasks/'+task.id+'/cancel',headers=self.h,json={'reason':'browser_deadline'})
   self.assertEqual(response.status_code,200,response.text)
   self.assertIn('5分30秒',task.error)
  finally:task.finish()

 def test_normal_clarification_remains_available_in_history(self):
  from execution_context import history_reader
  identifier=uuid.uuid4().hex
  value={'turns':[{'id':'n','question':'100','answer':'请说明100的单位。','status':'notice'},{'id':'e','question':'failed','answer':'不完整结果','status':'error'}]}
  with db() as c:c.execute('INSERT INTO workspace_dialogues VALUES (?,?,?,?,?,?)',('GSA02','F1','pm',identifier,json.dumps(value),'now'))
  self.assertEqual(history_reader(db,'GSA02','F1','pm',identifier)('100')['matches'],1)
  self.assertEqual(history_reader(db,'GSA02','F1','pm',identifier)('failed')['matches'],0)

 def test_delete_removes_text_and_late_save_cannot_restore_it(self):
  identifier=uuid.uuid4().hex
  value={'started':True,'conversationId':identifier,'turns':[{'question':'secret','answer':'private','status':'done'}]}
  self.assertEqual(self.c.delete(self.base+'/dialogues/'+identifier,headers=self.h).status_code,200)
  response=self.c.post(self.base+'/state',headers=self.h,json={'expected_revision':self.c.get(self.base+'/state',headers=self.h).json()['revision'],'value':{'current':value,'dialogues':{identifier:value}}})
  self.assertEqual(response.status_code,200,response.text)
  self.assertIsNone(self.c.get(self.base+'/dialogues/'+identifier,headers=self.h).json())
  saved=self.c.get(self.base+'/state',headers=self.h).json()['value']
  self.assertNotIn('secret',json.dumps(saved));self.assertNotIn(identifier,saved.get('dialogues',{}))
  with db() as c:marker=c.execute('SELECT value FROM workspace_dialogues WHERE actor=? AND id=?',('pm',identifier)).fetchone()[0]
  self.assertNotIn('private',marker)
