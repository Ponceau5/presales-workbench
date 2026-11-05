"""Fault injection verifies useful errors, retry bounds and no premature result writes."""
import json,os,tempfile,unittest,uuid
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
for key in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[key+'_API_KEY']=''
import httpx
from openai import APITimeoutError,APIConnectionError,RateLimitError,InternalServerError
from fastapi.testclient import TestClient
from app import app,db
import agent_engine
from model_gateway import ModelConfig,ModelError

class FailureRecoveryTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  self.config=ModelConfig('deepseek','fixture','https://example.invalid','fixture')
 def run_error(self,error,after=False):
  def generate(*a,**k):
   if after:yield {'type':'delta','text':'partial'}
   raise error
  with patch('agent_engine.model_config',return_value=self.config),patch('agent_engine.chat_model'),patch('agent_engine.stream_agent',side_effect=generate),patch('agent_engine.time.sleep'):
   with self.assertRaises(ModelError) as caught:list(agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F1',sources=[]))
  return str(caught.exception)
 def test_first_token_and_generation_timeout_are_distinct(self):
  error=APITimeoutError(request=httpx.Request('POST','https://example.invalid'))
  self.assertIn('首段',self.run_error(error));self.assertIn('生成中断',self.run_error(error,True))
 def test_rate_limit_and_unavailable_have_bounded_retry(self):
  for cls,status,text in ((RateLimitError,429,'限流'),(InternalServerError,503,'503')):
   response=httpx.Response(status,request=httpx.Request('POST','https://example.invalid'))
   error=cls('fixture',response=response,body={'error':{'code':'quota_exceeded'}})
   trace=[]
   with patch('agent_engine.model_config',return_value=self.config),patch('agent_engine.chat_model'),patch('agent_engine.stream_agent',side_effect=error) as stream,patch('agent_engine.time.sleep'):
    with self.assertRaises(ModelError) as caught:list(agent_engine.request_agent_stream([],user='pm',project='GSA02',stage='F1',sources=[],trace=trace))
    self.assertEqual([item['http_status'] for item in trace if item.get('metric')=='provider_error'],[status,status])
    self.assertEqual([item['code'] for item in trace if item.get('metric')=='provider_error'],['quota_exceeded','quota_exceeded'])
    self.assertIn(text,str(caught.exception));self.assertEqual(stream.call_count,2)
 def test_real_tool_deadline_reports_timeout(self):
  import time
  from langchain_core.tools import ToolException
  wrapped=agent_engine.bounded_tool(lambda:time.sleep(.05),timeout=.005)
  with self.assertRaises(ToolException) as caught:wrapped()
  self.assertIn('工具处理超时',str(caught.exception))
  time.sleep(.06)

 def test_network_disconnect_has_explicit_error(self):
  self.assertIn('网络连接中断',self.run_error(APIConnectionError(request=httpx.Request('POST','https://example.invalid')),True))
 def test_interrupted_result_not_saved_and_same_turn_retries_safely(self):
  turn=uuid.uuid4().hex;endpoint='/api/projects/GSA02/workspaces/F1/ask-stream';body={'question':'测试故障恢复','turn_id':turn}
  def interrupted(*a,**k):yield 'partial';raise ModelError('工具等待超时，请重试')
  with patch('workspace_router.model_config',return_value=self.config),patch('workspace_router.request_agent_stream',side_effect=interrupted):
   response=self.c.post(endpoint,headers=self.h,json=body)
  self.assertIn('工具等待超时',response.text)
  with db() as c:self.assertIsNone(c.execute('SELECT 1 FROM workspace_replies WHERE id=?',(turn,)).fetchone())
  with patch('workspace_router.model_config',return_value=self.config),patch('workspace_router.request_agent_stream',side_effect=lambda *a,**k:iter(['recovered'])) as stream:
   response=self.c.post(endpoint,headers=self.h,json=body);self.assertIn('done',response.text)
   again=self.c.post(endpoint,headers=self.h,json=body);self.assertIn('recovered',again.text);self.assertEqual(stream.call_count,1)
  with db() as c:self.assertEqual(c.execute('SELECT count(*) FROM workspace_replies WHERE id=?',(turn,)).fetchone()[0],1)
  metrics=self.c.get('/api/projects/GSA02/workspaces/F1/executions/'+turn+'/metrics',headers=self.h).json();self.assertEqual(metrics['status'],'completed');self.assertIsNotNone(metrics['first_token'])
