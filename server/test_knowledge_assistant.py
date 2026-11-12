import sqlite3, unittest
from contextlib import contextmanager
from unittest.mock import patch, AsyncMock
from fastapi import FastAPI
from fastapi.testclient import TestClient
import knowledge_assistant as k
import project_retrieval
class Tests(unittest.TestCase):
 def setUp(self):
  self.c=sqlite3.connect(':memory:',check_same_thread=False);self.c.row_factory=sqlite3.Row
  self.c.executescript('CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,version TEXT,filename TEXT,path TEXT,sha256 TEXT,actor TEXT,created_at TEXT);CREATE TABLE document_pages(document_id TEXT,page INTEGER,text TEXT);CREATE TABLE document_registry(document_id TEXT,category TEXT);')
  @contextmanager
  def db():
   with self.c:yield self.c
  self.db=db;project_retrieval.initialize(db);self.upload=AsyncMock(return_value={'id':'new','version':'V2'})
  app=FastAPI();k.install(app,db,lambda:'reader',self.upload);self.client=TestClient(app)
  self.admin=patch.object(k.access_control,'is_admin',return_value=True);self.admin.start()
 def tearDown(self):self.admin.stop();self.c.close()
 def seed(self,id='a',project=k.PUBLIC_SCOPE,version='V1',enabled=1):
  self.c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',(id,project,'网关手册',version,'gateway.md','/not-read','hash','admin','2026-11-07'))
  self.c.execute('INSERT INTO document_pages VALUES (?,?,?)',(id,1,'网关支持 Modbus TCP，最大 32 台设备。'))
  self.c.execute('INSERT INTO public_knowledge_documents VALUES (?,?,?,?)',(id,enabled,'产品规格','BMS'));self.c.commit()
  self.assertEqual(project_retrieval.index_document(self.db,id),'ready')
 def ask(self,q='网关'):return self.client.post('/api/knowledge/ask',json={'question':q})
 def test_empty(self):
  with patch.object(k,'request_chat') as m:self.assertEqual(self.ask().json()['status'],'empty');m.assert_not_called()
 def test_evidence(self):
  self.seed()
  with patch.object(k,'request_chat',return_value='32 台 [S1]') as m:
   r=self.ask();self.assertEqual(r.status_code,200);s=r.json()['sources'][0];self.assertEqual((s['version'],s['page']),('V1',1));self.assertIn('最大 32 台',m.call_args.args[0][1]['content'])
 def test_disabled(self):
  self.seed(enabled=0)
  with patch.object(k,'request_chat') as m:self.assertEqual(self.ask().json()['status'],'empty');m.assert_not_called()
 def test_private(self):
  self.seed(project='PRIVATE')
  with patch.object(k,'request_chat') as m:self.assertEqual(self.ask().json()['sources'],[]);m.assert_not_called()
  self.assertEqual(self.client.get('/api/knowledge/documents/a/download').status_code,404)
 def test_activation(self):
  self.seed();self.seed('b',version='V2',enabled=0)
  self.assertEqual(self.client.patch('/api/knowledge/documents/b',json={'enabled':True}).status_code,200)
  self.assertEqual(self.c.execute("SELECT enabled FROM public_knowledge_documents WHERE document_id='a'").fetchone()[0],0)
 def test_reader(self):
  self.seed()
  with patch.object(k.access_control,'is_admin',return_value=False):
   self.assertEqual(self.client.get('/api/knowledge/documents').status_code,200)
   self.assertEqual(self.client.patch('/api/knowledge/documents/a',json={'enabled':False}).status_code,403)
 def test_upload(self):
  self.seed();r=self.client.post('/api/knowledge/documents',data={'title':'网关手册','version':'V2'},files={'file':('new.md',b'text')})
  self.assertEqual(r.status_code,200);self.assertEqual(self.upload.call_args.args[0],k.PUBLIC_SCOPE)
  self.assertEqual(self.c.execute("SELECT enabled FROM public_knowledge_documents WHERE document_id='a'").fetchone()[0],0)
 def test_no_match(self):
  self.seed()
  with patch.object(k,'request_chat') as m:self.assertEqual(self.ask('UPS电池寿命').json()['sources'],[]);m.assert_not_called()
 def test_whitespace(self):self.assertEqual(self.ask('  ').status_code,422)
if __name__=='__main__':unittest.main()
