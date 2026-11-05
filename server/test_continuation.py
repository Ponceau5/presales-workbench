"""Version, parse, retrieval and retired-input regression on an isolated database."""
import io,json,os,tempfile,unittest,uuid
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
os.environ['PRESALES_DATA_DIR']=root.name
for key in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[key+'_API_KEY']=''
from app import app,db,now
from fastapi.testclient import TestClient
from solution_materials import ProjectMaterials
from langchain_core.tools import ToolException
from pypdf import PdfWriter
from openpyxl import Workbook

class ContinuationTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  self.p='TEST-CONT-'+uuid.uuid4().hex[:8]
  self.c.post('/api/access/projects',headers=self.h,json={'id':self.p,'name':self.p})
 def upload(self,name,raw=b'needle original text',kind='规格与要求',version='V1',title=None):
  with patch('document_lifecycle.schedule'):
   return self.c.post(f'/api/projects/{self.p}/documents',headers=self.h,data={'title':title or name,'version':version,'business_type':kind},files={'file':(name,raw)})
 def test_versions_metadata_and_disabled_entry_paths(self):
  first=self.upload('template.txt',kind='工件模板').json()['id']
  reader=ProjectMaterials(db,self.p,'F1')
  self.assertEqual(reader.search('needle')['status'],'matched')
  with patch('document_lifecycle.schedule'):
   updated=self.c.put(f'/api/documents/{first}',headers=self.h,data={'version':'V99'},files={'file':('new.txt',b'needle new text')})
  self.assertEqual(updated.status_code,200,updated.text);self.assertEqual(updated.json()['version'],'V2')
  latest=updated.json()['id']
  docs={d['id']:d for d in self.c.get(f'/api/projects/{self.p}/documents',headers=self.h).json()}
  self.assertEqual(docs[latest]['business_type'],'工件模板');self.assertEqual(docs[first]['category'],'disabled')
  self.assertEqual(docs[latest]['category'],'template')
  self.assertEqual(self.c.get(f'/api/documents/{latest}/versions',headers=self.h).json()[1]['id'],first)
  for payload in ({'attachment_ids':[first]},{'selected_pages':[{'document_id':first,'page':1}]}):
   response=self.c.post(f'/api/projects/{self.p}/workspaces/F1/ask-stream',headers=self.h,json={'question':'test','turn_id':uuid.uuid4().hex,**payload})
   self.assertEqual(response.status_code,409,response.text)
  self.assertEqual(ProjectMaterials(db,self.p,'F1').search('original')['status'],'no_match')
  self.assertEqual(self.c.get(f'/api/documents/{first}/download',headers=self.h).content,b'needle original text')
 def test_formats_originals_and_retry(self):
  pdf=io.BytesIO();writer=PdfWriter();writer.add_blank_page(200,200);writer.write(pdf)
  xlsx=io.BytesIO();book=Workbook();book.active.append(['needle','Excel']);book.save(xlsx)
  fixtures=[('valid.txt',b'needle valid','text'),('valid.pdf',pdf.getvalue(),'text'),('broken.pdf',b'bad PDF','unparsed'),('valid.xlsx',xlsx.getvalue(),'text'),('bad.xlsx',b'bad office','unparsed'),('unknown.xyz',b'opaque','unparsed'),('image.png',b'fake image','image')]
  for name,raw,status in fixtures:
   with self.subTest(name=name):
    response=self.upload(name,raw);self.assertEqual(response.status_code,200,response.text)
    self.assertEqual(response.json()['parse_status'],status)
    self.assertEqual(self.c.get('/api/documents/'+response.json()['id']+'/download',headers=self.h).content,raw)
  self.assertEqual(self.upload('empty.txt',b'').status_code,422)
  rows=self.c.get(f'/api/projects/{self.p}/documents',headers=self.h).json();bad=next(d for d in rows if d['filename']=='broken.pdf')
  response=self.c.post(f"/api/documents/{bad['id']}/analysis/retry",headers=self.h)
  self.assertEqual(response.json()['status'],'failed');self.assertTrue(response.json()['original_retained'])
 def test_retrieval_failure_recovery_project_scope_and_citation(self):
  identifier=self.upload('source.txt').json()['id']
  endpoint=f'/api/projects/{self.p}/materials/search'
  found=self.c.post(endpoint,headers=self.h,json={'query':'needle'}).json()
  self.assertEqual(found['hits'][0]['version'],'V1');self.assertEqual(str(found['hits'][0]['page']),'1');self.assertEqual(found['hits'][0]['title'],'source.txt')
  self.assertEqual(self.c.post('/api/projects/GSA02/materials/search',headers=self.h,json={'query':'needle'}).json()['hits'],[])
  with db() as c:c.execute("UPDATE material_indexes SET status='failed' WHERE document_id=?",(identifier,));c.execute('DELETE FROM material_chunks WHERE document_id=?',(identifier,))
  self.assertEqual(self.c.post(endpoint,headers=self.h,json={'query':'needle'}).json()['status'],'index_not_ready')
  self.assertEqual(self.c.post(f'/api/documents/{identifier}/index/retry',headers=self.h).json()['status'],'ready')
  self.assertEqual(self.c.post(endpoint,headers=self.h,json={'query':'needle'}).json()['status'],'matched')
 def test_hyphenated_project_marker_is_retrieved_as_one_term(self):
  self.upload('marker.txt',b'PROJECT-A-UNIQUE123 precise evidence')
  self.upload('filler.txt',b'A project filler '*1000)
  result=self.c.post(f'/api/projects/{self.p}/materials/search',headers=self.h,json={'query':'PROJECT-A-UNIQUE123'}).json()
  self.assertEqual(result['status'],'matched')
  self.assertEqual({hit['title'] for hit in result['hits']},{'marker.txt'})

 def test_private_attachment_direct_urls_and_task_inputs_are_actor_scoped(self):
  identifier=self.upload('private.txt').json()['id']
  with db() as c:c.execute("UPDATE document_registry SET category='temporary' WHERE document_id=?",(identifier,))
  self.c.put(f'/api/projects/{self.p}/members',headers=self.h,json={'user_id':'software','visible':True})
  self.c.put(f'/api/projects/{self.p}/owners',headers=self.h,json={'role':'software','user_id':'software','expected_revision':0})
  other={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'software','password':'demo2026'}).json()['token']}
  for suffix in ('download','pages/1','analysis','versions'):
   self.assertEqual(self.c.get(f'/api/documents/{identifier}/{suffix}',headers=other).status_code,403)
  for payload in ({'attachment_ids':[identifier]},{'selected_pages':[{'document_id':identifier,'page':1}]}):
   response=self.c.post(f'/api/projects/{self.p}/workspaces/F5/ask-stream',headers=other,json={'question':'test','turn_id':uuid.uuid4().hex,**payload})
   self.assertEqual(response.status_code,403)
  self.assertEqual(self.c.get(f'/api/documents/{identifier}/download',headers=self.h).status_code,200)

 def test_artifact_update_retains_original_and_can_disable(self):
  identifier=uuid.uuid4().hex
  with db() as c:c.execute('INSERT INTO workspace_artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?)',(identifier,self.p,'F1','origin','测试成果','original artifact',1,'pm','test','[]',now()))
  with patch('document_lifecycle.schedule'):
   response=self.c.put(f'/api/projects/{self.p}/artifacts/{identifier}',headers=self.h,files={'file':('replacement.txt',b'needle replacement')})
  self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['version'],'V2')
  latest=response.json()['id']
  catalog=self.c.get(f'/api/projects/{self.p}/workspaces/F1/materials',headers=self.h).json()
  self.assertNotIn(identifier,[r['id'] for r in catalog['outputs']]);self.assertIn(latest,[r['id'] for r in catalog['outputs']])
  versions=self.c.get(f'/api/documents/{latest}/versions',headers=self.h).json();self.assertIn(identifier,[r['id'] for r in versions])
  self.assertEqual(self.c.post(f'/api/documents/{latest}/disable',headers=self.h).status_code,200)
  self.assertEqual(self.c.get(f'/api/documents/{latest}/download',headers=self.h).content,b'needle replacement')

if __name__=='__main__':unittest.main()
