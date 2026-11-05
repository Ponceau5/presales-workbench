import os,tempfile,json,unittest
from pathlib import Path
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from app import app,db,now
from fastapi.testclient import TestClient
import project_retrieval as retrieval
class RetrievalQualityTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.client=TestClient(app);cls.h={'Authorization':'Bearer '+cls.client.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  with db() as c:
   for identifier,project,title,version,page,text in [('bms-current','GSA02','楼控点表','V1',2,'BMS 点表，确认点数37。'),('bms-old','GSA02','旧楼控点表','V0',2,'BMS 点表，旧点数11。'),('private-bms','RCJM1','私人BMS','V0',1,'BMS 点表私人标记。'),('epms-current','GSA02','电力监控资料','V0',1,'EPMS 阈值52。'),('boq-current','GSA02','客户工程量清单','V0',3,'工程量清单：设备3台。'),('soo-current','GSA02','控制要求','V0',4,'SOO 控制要求：停机联锁。')]:
    c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',(identifier,project,title,version,identifier+'.txt','test','sha','pm',now()));c.execute('INSERT INTO document_pages VALUES (?,?,?)',(identifier,page,text))
   # Disabled old version must never enter a new search.
   c.execute("INSERT INTO document_registry(document_id,category,reason,registered_by,updated_at) VALUES ('bms-old','disabled','test','pm','now')")
  for identifier in ('bms-current','bms-old','private-bms','epms-current','boq-current','soo-current'):retrieval.index_document(db,identifier)
 def test_business_queries_versions_pages_and_project_isolation(self):
  cases=json.loads((Path(__file__).resolve().parents[1]/'tests/retrieval_cases.json').read_text())
  for case in cases:
   with self.subTest(query=case['query']):
    result=self.client.post('/api/projects/GSA02/materials/search',headers=self.h,json={'query':case['query'],'workspace_id':'F1'}).json()
    self.assertEqual(result['status'],'matched',result);hit=result['hits'][0]
    self.assertEqual((hit['document_id'],hit['version'],hit['page']),(case['document'],case['version'],case['page']))
    self.assertTrue(all(h['document_id'] not in case['forbidden'] for h in result['hits']))
 def test_no_match_not_ready_and_permission_are_distinct(self):
  result=retrieval.search(db,'GSA02','ZZZ-NO-SUCH-TERM');self.assertEqual(result['status'],'no_match')
  with db() as c:c.execute("UPDATE material_indexes SET status='failed' WHERE document_id='soo-current'")
  self.assertEqual(retrieval.search(db,'GSA02','ZZZ-NO-SUCH-TERM')['status'],'index_not_ready')
  sales={'Authorization':'Bearer '+self.client.post('/api/session',json={'username':'marketing','password':'demo2026'}).json()['token']}
  self.assertEqual(self.client.post('/api/projects/NO-ACCESS/materials/search',headers=sales,json={'query':'BMS'}).status_code,403)
 def test_z1_case_insensitive_body_and_literal_wildcards(self):
  with db() as c:
   c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',('lowercase','GSA02','英文正文','V0','lower.txt','test','sha','pm',now()))
   c.execute('INSERT INTO document_pages VALUES (?,?,?)',('lowercase',7,'bms lowercase body contains exact 20% value and serial_id.'))
  self.assertEqual(retrieval.index_document(db,'lowercase'),'ready')
  for query in ('BMS','20%','serial_id'):
   with self.subTest(query=query):
    result=retrieval.search(db,'GSA02',query,identifiers=['lowercase'])
    self.assertEqual(result['status'],'matched');self.assertEqual(result['hits'][0]['page'],7)
  self.assertEqual(retrieval.search(db,'GSA02','21%',identifiers=['lowercase'])['status'],'no_match')
 def test_z2_workspace_filter_and_disabled_vectors(self):
  with db() as c:c.execute("INSERT INTO workspace_material_tags VALUES ('lowercase','F2','input')")
  self.assertEqual(retrieval.search(db,'GSA02','BMS',identifiers=['lowercase'],stage='F1')['hits'],[])
  self.assertTrue(retrieval.search(db,'GSA02','BMS',identifiers=['lowercase'],stage='F2')['hits'])
  with db() as c:
   if getattr(c,'dialect','sqlite')=='postgresql':
    self.assertEqual(c.execute("SELECT count(*) FROM material_vectors WHERE document_id='bms-old'").fetchone()[0],0)
 def test_z3_version_change_reindexes_and_disable_removes_results(self):
  with db() as c:
   c.execute("UPDATE documents SET version='V2' WHERE id='lowercase'")
   c.execute("UPDATE document_pages SET text='newmarker only current data' WHERE document_id='lowercase'")
  self.assertEqual(retrieval.search(db,'GSA02','BMS',identifiers=['lowercase'])['hits'],[])
  self.assertEqual(retrieval.index_document(db,'lowercase'),'ready')
  hits=retrieval.search(db,'GSA02','newmarker',identifiers=['lowercase'])['hits'];self.assertEqual(hits[0]['version'],'V2')
  with db() as c:
   c.execute("INSERT INTO document_registry(document_id,category,reason,registered_by,updated_at) VALUES ('lowercase','disabled','synthetic','pm','now')")
  self.assertEqual(retrieval.index_document(db,'lowercase'),'disabled')
  self.assertEqual(retrieval.search(db,'GSA02','newmarker',identifiers=['lowercase'])['hits'],[])
  with db() as c:
   if getattr(c,'dialect','sqlite')=='postgresql':self.assertEqual(c.execute("SELECT count(*) FROM material_vectors WHERE document_id='lowercase'").fetchone()[0],0)
 def test_z4_unparsed_and_pending_index_have_distinct_status(self):
  with db() as c:c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)',('unparsed-fixture','GSA02','未解析合成原件','V0','fixture.bin','test','sha','pm',now()))
  self.assertEqual(retrieval.index_document(db,'unparsed-fixture'),'unparsed')
  self.assertEqual(retrieval.search(db,'GSA02','ZZZ',identifiers=['unparsed-fixture'])['status'],'unparsed')
  with db() as c:c.execute("UPDATE material_indexes SET status='failed' WHERE document_id='unparsed-fixture'")
  self.assertEqual(retrieval.search(db,'GSA02','ZZZ',identifiers=['unparsed-fixture'])['status'],'index_not_ready')
