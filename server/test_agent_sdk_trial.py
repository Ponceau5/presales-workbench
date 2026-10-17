"""SDK tool boundaries, exact arithmetic and model-selected tool loop."""
import os,tempfile,unittest,json
from unittest.mock import patch
from uuid import uuid4
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatResult,ChatGeneration
from langchain_core.tools import ToolException
from fastapi import HTTPException
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from app import app,db,now
from fastapi.testclient import TestClient
from agent_sdk_trial import tools_for,Page,stream_trial
class ScriptedModel(BaseChatModel):
 calls:int=0
 @property
 def _llm_type(self):return 'sdk-test'
 def bind_tools(self,tools,**kwargs):return self
 def _generate(self,messages,stop=None,run_manager=None,**kwargs):
  sequence=[('list_selected_materials',{}),('read_material_page',{'document_id':'sdk-selected','page':1}),('calculate_line_totals',{'lines':[{'quantity':6,'unit_cost':'12.50'},{'quantity':4,'unit_cost':'30.00'}]})]
  if self.calls<len(sequence):
   name,args=sequence[self.calls];message=AIMessage(content='',tool_calls=[{'id':str(self.calls),'name':name,'args':args,'type':'tool_call'}])
  else:message=AIMessage(content='材料小计195.00 CNY，资料V1。')
  self.calls+=1
  return ChatResult(generations=[ChatGeneration(message=message)])
class TrialTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with db() as c:
   for identifier,project in [('sdk-selected','GSA02'),('sdk-other','RCJM1')]:
    c.execute('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?,?,?,?,?)',(identifier,project,'测试清单','V1','test.md','synthetic','hash','pm',now()))
    c.execute('INSERT OR REPLACE INTO document_pages VALUES (?,?,?)',(identifier,1,'设备A 6*12.5；设备B 4*30。'))
 def setUp(self):
  self.trace=[];self.tools={t.name:t for t in tools_for(db,'sales','GSA02',[Page(document_id='sdk-selected',page=1),Page(document_id='sdk-other',page=1)],{},self.trace)}
 def test_tool_loop_runs_in_sdk(self):
  model=ScriptedModel();events=list(stream_trial(model,list(self.tools.values()),'# Skill\n只给小计和版本。','核对材料小计',self.trace))
  self.assertEqual(model.calls,4);self.assertEqual(events[-1]['type'],'result');self.assertIn('195.00',events[-1]['answer'])
  self.assertEqual([x['tool'] for x in self.trace],['list_selected_materials','read_material_page','calculate_line_totals'])
 def test_trial_endpoint_uses_current_skill_without_adopting(self):
  client=TestClient(app);token=client.post('/api/session',json={'username':'sales','password':'demo2026'}).json()['token'];headers={'Authorization':'Bearer '+token}
  with db() as c:before=c.execute('SELECT count(*) FROM workspace_artifacts').fetchone()[0]
  with patch('agent_sdk_trial.chat_model',return_value=ScriptedModel()):
   result=client.post('/api/projects/GSA02/workspaces/F7/flows/sdk-trial-stream',headers=headers,json={'question':'核对材料小计','task_id':'cost','selected_pages':[{'document_id':'sdk-selected','page':1}]})
  self.assertEqual(result.status_code,200,result.text);events=[json.loads(v[6:]) for v in result.text.splitlines() if v.startswith('data: ')]
  done=next(e for e in events if e['type']=='done')
  with db() as c:
   saved=c.execute('SELECT * FROM sdk_trials WHERE id=?',(done['trial_id'],)).fetchone();self.assertEqual(saved['status'],'completed');self.assertIn('195.00',saved['output']);self.assertEqual(c.execute('SELECT count(*) FROM workspace_artifacts').fetchone()[0],before)
  with patch('agent_sdk_trial.chat_model') as model:
   denied=client.post('/api/projects/GSA02/workspaces/F7/flows/sdk-trial-stream',headers=headers,json={'question':'读取其他项目','task_id':'cost','selected_pages':[{'document_id':'sdk-other','page':1}]})
  self.assertEqual(denied.status_code,403);model.assert_not_called()
 def test_other_project_and_unselected_page_rejected(self):
  with self.assertRaises(ToolException):self.tools['read_material_page'].invoke({'document_id':'sdk-other','page':1})
  with self.assertRaises(ToolException):self.tools['read_material_page'].invoke({'document_id':'sdk-selected','page':2})
  self.assertNotIn('sdk-other',self.tools['list_selected_materials'].invoke({}))
 def test_permission_checked_at_every_call(self):
  with patch('access_control.check_project',side_effect=HTTPException(403,'denied')):
   with self.assertRaises(HTTPException):self.tools['get_task_parameters'].invoke({})
 def test_decimal_and_call_budget(self):
  tool=self.tools['calculate_line_totals'];value=json.loads(tool.invoke({'lines':[{'quantity':3,'unit_cost':'0.10'}]}));self.assertEqual(value['total'],'0.30')
  for i in range(7):self.tools['get_task_parameters'].invoke({})
  with self.assertRaises(ToolException):self.tools['get_task_parameters'].invoke({})
if __name__=='__main__':unittest.main()
