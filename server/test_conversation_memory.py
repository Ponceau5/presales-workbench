import json,os,tempfile,unittest,uuid
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from fastapi.testclient import TestClient
from app import app,db,now
from conversation_memory import token_count
from execution_context import compact_history
class BusinessMemoryTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']};self.base='/api/projects/GSA02/workspaces/F1';self.id=uuid.uuid4().hex
 def save(self,turns):
  revision=self.c.get(self.base+'/state',headers=self.h).json()['revision']
  r=self.c.post(self.base+'/state',headers=self.h,json={'expected_revision':revision,'value':{'current':{'conversationId':self.id,'started':True,'turns':turns}}});self.assertEqual(r.status_code,200,r.text)
 def test_35_turns_preserve_customer_condition_and_paged_originals(self):
  turns=[{'id':'early','question':'客户确认：离线部署，保留180天，采用需求V0。','answer':'已记录','status':'done'}]+[{'id':str(i),'question':'无关讨论'+str(i),'answer':'讨论内容'*300,'status':'done'} for i in range(34)]
  self.save(turns)
  card=self.c.get(self.base+'/dialogues/'+self.id+'/facts',headers=self.h).json()
  self.assertIn('180天',json.dumps(card,ensure_ascii=False));self.assertEqual(card['facts'][0]['turn_id'],'early')
  history=self.c.get(self.base+'/dialogues/'+self.id+'/history?offset=20&limit=10',headers=self.h).json();self.assertEqual(history['total'],35);self.assertEqual(len(history['turns']),10)
  self.assertLessEqual(token_count(compact_history(json.dumps({'turns':turns},ensure_ascii=False))),2000)
  sales={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'sales','password':'demo2026'}).json()['token']}
  self.assertEqual(self.c.get(self.base+'/dialogues/'+self.id+'/facts',headers=sales).json()['facts'],[])
  self.assertEqual(self.c.get(self.base+'/dialogues/'+self.id+'/history',headers=sales).json()['total'],0)
  self.c.delete(self.base+'/dialogues/'+self.id,headers=self.h)
  self.assertEqual(self.c.get(self.base+'/dialogues/'+self.id+'/history',headers=self.h).json()['total'],0)
 def test_changed_source_invalidates_fact_but_preserves_provenance(self):
  doc=uuid.uuid4().hex;turn=uuid.uuid4().hex
  with db() as c:
   c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',(doc,'GSA02','需求书','V0','requirements.txt','test','sha','pm',now()))
   c.execute('INSERT INTO execution_inputs VALUES (?,?,?,?,?,?,?)',(turn,'GSA02','F1','pm','{}',json.dumps([{'id':doc,'version':'V0','title':'需求书'}]),'test'))
  self.save([{'id':turn,'question':'确认需求书V0：保留180天。','answer':'记录','status':'done'}])
  with db() as c:c.execute('UPDATE documents SET version=? WHERE id=?',('V1',doc))
  card=self.c.get(self.base+'/dialogues/'+self.id+'/facts',headers=self.h).json()
  self.assertEqual(card['facts'],[]);self.assertEqual(card['invalidated_facts'][0]['source_versions'][0]['version'],'V0')
  self.assertEqual(self.c.get(self.base+'/dialogues/'+self.id+'/history',headers=self.h).json()['total'],1)
