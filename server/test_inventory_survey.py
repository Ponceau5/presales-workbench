import json,os,tempfile,unittest,uuid
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
for key in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[key+'_API_KEY']=''
from fastapi.testclient import TestClient
from app import app,db,now
from solution_materials import ProjectMaterials
from model_gateway import ModelConfig,ModelError
from langchain.agents.middleware.model_call_limit import ModelCallLimitExceededError
import agent_engine

class InventorySurveyTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.client=TestClient(app)
  cls.headers={'Authorization':'Bearer '+cls.client.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  with db() as c:
   for i in range(35):
    c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',(f'inventory-{i}','GSA02',f'资料{i}','V0','fixture.txt','fixture','hash','pm',now()))
    if i!=34:c.execute('INSERT INTO document_pages VALUES (?,?,?)',(f'inventory-{i}',1,'已解析的合成测试正文。'*150))
  cls.config=ModelConfig('deepseek','fixture','https://fixture.invalid','fixture')
 def test_inventory_includes_later_files_and_distinguishes_unparsed(self):
  result=ProjectMaterials(db,'GSA02','F5').survey()
  self.assertEqual(result['total_documents'],35)
  self.assertEqual(len(result['documents']),35)
  last=next(d for d in result['documents'] if d['id']=='inventory-34')
  self.assertEqual(last['read_status'],'暂无可读取正文')
  self.assertLessEqual(sum(len(p['text']) for d in result['documents'] for p in d['excerpts']),12000)
 def test_f5_survey_prepares_evidence_once_and_disables_model_tool_loop(self):
  captured={}
  def model(messages,**kwargs):
   captured.update(kwargs);captured['messages']=messages;yield '本项目登记35份资料，1份暂无可读取正文。'
  turn=uuid.uuid4().hex
  with patch('workspace_router.model_config',return_value=self.config),patch('workspace_router.request_agent_stream',side_effect=model):
   response=self.client.post('/api/projects/GSA02/workspaces/F5/ask-stream',headers=self.headers,json={'question':'请生成项目资料摸排','conversation_id':'inventory','turn_id':turn})
  self.assertIn('"type": "done"',response.text,response.text)
  self.assertFalse(captured['allow_tools'])
  self.assertIn('inventory-34',captured['messages'][1]['content'])
  self.assertIn('35',response.text)
 def test_call_limit_has_specific_message(self):
  error=ModelCallLimitExceededError(8,8,None,8)
  with patch('agent_engine.model_config',return_value=self.config),patch('agent_engine.chat_model'),patch('agent_engine.stream_agent',side_effect=error):
   with self.assertRaises(ModelError) as caught:list(agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F5',sources=[]))
  self.assertIn('执行次数上限',str(caught.exception));self.assertNotIn('检查模型配置',str(caught.exception))
