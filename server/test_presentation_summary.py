import io,json,os,tempfile,unittest,uuid,zipfile
from unittest.mock import patch
from pathlib import Path
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
os.environ['PRESALES_DATA_DIR']=root.name
for key in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[key+'_API_KEY']=''
from app import app,db,pages
from fastapi.testclient import TestClient
from fastapi import HTTPException
import document_lifecycle

def pptx(text=True):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="1" r:id="r2"/><p:sldId id="2" r:id="r1"/></p:sldIdLst></p:presentation>')
  z.writestr('ppt/_rels/presentation.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>')
  for i in (1,2):z.writestr(f'ppt/slides/slide{i}.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spTree><a:p>'+('<a:r><a:t>'+('第二页' if i==1 else '设备数量20')+'</a:t></a:r>' if text else '')+'</a:p></p:spTree></p:sld>')
 return out.getvalue()
class PresentationSummaryTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  self.p='TEST-PPT-'+uuid.uuid4().hex[:8];self.c.post('/api/access/projects',headers=self.h,json={'id':self.p,'name':self.p})
 def upload(self,raw):
  with patch('document_lifecycle.schedule'):
   r=self.c.post(f'/api/projects/{self.p}/documents',headers=self.h,data={'title':'摘要回归','version':'V0'},files={'file':('test.pptx',raw)})
  self.assertEqual(r.status_code,200,r.text);return r.json()['id']
 def test_slide_order_upload_and_legacy_retry_generate_summary(self):
  raw=pptx();identifier=self.upload(raw)
  with db() as c:
   texts=[r[0] for r in c.execute('SELECT text FROM document_pages WHERE document_id=? ORDER BY page',(identifier,))]
   self.assertEqual(texts,['设备数量20','第二页'])
   c.execute('DELETE FROM document_pages WHERE document_id=?',(identifier,))
  with patch('document_lifecycle._summary_pool.submit') as schedule:
   r=self.c.post(f'/api/documents/{identifier}/analysis/retry',headers=self.h)
   self.assertEqual(r.json()['status'],'queued');schedule.assert_called_once()
   self.assertTrue(callable(schedule.call_args.args[0]))
  with patch('document_lifecycle.request_chat',return_value='测试设备数量为20。') as model:
   document_lifecycle._analyze(identifier)
  result=self.c.get(f'/api/documents/{identifier}/analysis',headers=self.h).json()
  self.assertEqual(result['status'],'ready');self.assertIn('20',result['summary']);self.assertIn('设备数量20',str(model.call_args))
  self.assertEqual(self.c.get(f'/api/documents/{identifier}/download',headers=self.h).content,raw)
 def test_broken_presentation_has_correct_persisted_error(self):
  identifier=self.upload(b'PK\xff\xfebroken')
  r=self.c.post(f'/api/documents/{identifier}/analysis/retry',headers=self.h).json()
  self.assertEqual(r['status'],'failed');self.assertIn('PPTX',r['error']);self.assertNotIn('UTF-8',r['error'])
  saved=self.c.get(f'/api/documents/{identifier}/analysis',headers=self.h).json();self.assertEqual(saved['error'],r['error'])
 def test_image_only_presentation_does_not_invent_summary(self):
  identifier=self.upload(pptx(False))
  with patch('document_lifecycle.schedule') as schedule:
   result=self.c.post(f'/api/documents/{identifier}/analysis/retry',headers=self.h).json()
  self.assertEqual(result['status'],'failed');self.assertIn('没有可提取的文字',result['error']);schedule.assert_not_called()
 def test_pending_summary_does_not_queue_again(self):
  identifier=self.upload(pptx())
  with db() as c:c.execute('INSERT OR REPLACE INTO document_analysis VALUES (?,?,?,?,?)',(identifier,'running','','','2026-10-27'))
  with patch('document_lifecycle.schedule') as schedule:
   result=self.c.post(f'/api/documents/{identifier}/analysis/retry',headers=self.h).json()
  self.assertEqual(result['status'],'running');schedule.assert_not_called()
if __name__=='__main__':unittest.main()
