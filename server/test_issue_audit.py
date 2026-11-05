import os,tempfile,unittest,uuid
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
os.environ['PRESALES_DATA_DIR']=root.name
for key in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[key+'_API_KEY']=''
from app import app,db
from fastapi.testclient import TestClient
class OriginalIssueAuditTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']}
  self.p='AUDIT-'+uuid.uuid4().hex[:7];self.c.post('/api/access/projects',headers=self.h,json={'id':self.p,'name':self.p})
 def upload(self,raw,version='V0'):
  with patch('document_lifecycle.schedule'):
   return self.c.post(f'/api/projects/{self.p}/documents',headers=self.h,data={'title':'同名测试资料','version':version},files={'file':('same.txt',raw)})
 def test_changed_same_title_requires_explicit_update(self):
  first=self.upload(b'original');self.assertEqual(first.status_code,200,first.text)
  second=self.upload(b'changed');self.assertEqual(second.status_code,409,second.text);self.assertIn('更新',second.json()['detail'])
  with patch('document_lifecycle.schedule'):
   update=self.c.put('/api/documents/'+first.json()['id'],headers=self.h,files={'file':('same.txt',b'changed')})
  self.assertEqual(update.status_code,200,update.text);self.assertEqual(update.json()['version'],'V1')
  rows=self.c.get(f'/api/projects/{self.p}/documents',headers=self.h).json();self.assertEqual(sum(r['category']!='disabled' for r in rows),1)
 def test_identical_import_keeps_current_version(self):
  first=self.upload(b'same','V3').json();again=self.upload(b'same','V0').json()
  self.assertEqual(again['id'],first['id']);self.assertEqual(again['version'],'V3')
 def test_project_detail_edit_delete_are_admin_only(self):
  h={'Authorization':'Bearer '+self.c.post('/api/session',json={'username':'sales','password':'demo2026'}).json()['token']}
  for method,body in [('get',None),('patch',{'name':'test'}),('delete',None)]:
   kwargs={'headers':h}
   if body is not None:kwargs['json']=body
   r=getattr(self.c,method)('/api/access/projects/GSA02',**kwargs);self.assertEqual(r.status_code,403,r.text)
if __name__=='__main__':unittest.main()
