import os,tempfile,unittest,json,uuid
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
os.environ['PRESALES_DATA_DIR']=root.name
for prefix in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[prefix+'_API_KEY']=''
from fastapi.testclient import TestClient
from app import app,db,FILES_DIR
from execution_context import compact_history,source_excerpts,history_reader
class ImportRedesignTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.client=TestClient(app)
  token=cls.client.post('/api/session',json={'username':'pm','password':'demo2026'}).json()['token']
  cls.headers={'Authorization':'Bearer '+token}
 def project(self):
  p='IMPORT-'+uuid.uuid4().hex[:8]
  r=self.client.post('/api/access/projects',headers=self.headers,json={'id':p,'name':p})
  self.assertEqual(r.status_code,200,r.text)
  return p
 def batch(self,p,items,files):
  with patch('document_lifecycle.schedule'):
   return self.client.post(f'/api/projects/{p}/documents/batch',headers=self.headers,data={'metadata':json.dumps(items)},files=[('files',f) for f in files])
 def test_batch_partial_success_description_and_retry(self):
  p=self.project();items=[{'title':'目录/规格','version':'V0','business_type':'规格与要求','description':'说明一'},{'title':'目录/点表','version':'V0','business_type':'点表与配置'},{'title':'空文件','version':'V0'}]
  r=self.batch(p,items,[('a.txt',b'spec'),('b.txt',b'IO table'),('empty.txt',b'')]);self.assertEqual(r.status_code,200,r.text)
  value=r.json();self.assertEqual((value['succeeded'],value['failed']),(2,1),value)
  self.assertIn('空',value['results'][2]['error'])
  rows=self.client.get(f'/api/projects/{p}/documents',headers=self.headers).json();self.assertEqual(len(rows),2)
  self.assertEqual({r['version'] for r in rows},{'V0'})
  self.assertEqual({r['business_type'] for r in rows},{'规格与要求','点表与配置'})
  with db() as c:self.assertEqual(c.execute('SELECT description FROM document_annotations WHERE document_id=?',(value['results'][0]['id'],)).fetchone()['description'],'说明一')
  self.assertEqual(self.batch(p,[items[2]],[('fixed.txt',b'fixed')]).json()['succeeded'],1)
  self.assertEqual(len(self.client.get(f'/api/projects/{p}/documents',headers=self.headers).json()),3)
 def test_disabled_file_can_be_imported_again(self):
  p=self.project();meta=[{'title':'测试','version':'V0'}];files=[('a.txt',b'content')]
  first=self.batch(p,meta,files).json()['results'][0]['id']
  r=self.client.post(f'/api/documents/{first}/disable',headers=self.headers);self.assertEqual(r.status_code,200,r.text)
  second=self.batch(p,meta,files).json()['results'][0]['id'];self.assertNotEqual(first,second)
 def test_binary_manifest_does_not_break_list_or_delete(self):
  folder=FILES_DIR/'GSA02';folder.mkdir(exist_ok=True)
  (folder/'binary.pptx').write_bytes(b'PK\xff\xfe\x00binary')
  digest='a'*64
  (folder/'materials.json').write_text(json.dumps({'manifest':[{'id':'binary-test','sha256':digest,'snapshot_name':'binary.pptx','title':'测试PPTX'}]}))
  response=self.client.get('/api/projects/GSA02/documents',headers=self.headers);self.assertEqual(response.status_code,200,response.text)
  identifier='gsa-source-binary-test-'+digest[:12]
  self.assertIn(identifier,{r['id'] for r in response.json()})
  deleted=self.client.post(f'/api/documents/{identifier}/disable',headers=self.headers);self.assertEqual(deleted.status_code,200,deleted.text)
  response=self.client.get('/api/projects/GSA02/documents',headers=self.headers);self.assertEqual(response.status_code,200,response.text)
  with db() as c:self.assertEqual(c.execute('SELECT category FROM document_registry WHERE document_id=?',(identifier,)).fetchone()['category'],'disabled')
 def test_prompt_compaction_retains_full_snapshots(self):
  original={'turns':[{'id':str(i),'question':'条件'+str(i),'answer':'a'*6000} for i in range(20)]}
  raw=json.dumps(original,ensure_ascii=False);out=compact_history(raw)
  self.assertLessEqual(__import__('conversation_memory').token_count(out),2000);self.assertEqual(json.loads(out)['turns'][-1]['question'],'条件19');self.assertEqual(len(original['turns']),20)
  sources=[{'id':str(i),'text':'x'*12000} for i in range(20)];compact=source_excerpts(sources)
  self.assertLessEqual(sum(len(s.get('text','')) for s in compact),10000);self.assertEqual(len(sources[0]['text']),12000)
 def test_private_history_scope(self):
  p=self.project();value=json.dumps({'turns':[{'id':'t','question':'PRIVATE-ALPHA','answer':'secret','status':'done'}]})
  with db() as c:c.execute('INSERT INTO workspace_dialogues VALUES (?,?,?,?,?,?)',(p,'F1','pm','dialog',value,'2026-10-27'))
  self.assertEqual(history_reader(db,p,'F1','pm','dialog')('PRIVATE-ALPHA')['matches'],1)
  for args in [(p,'F2','pm','dialog'),(p,'F1','software','dialog'),('GSA02','F1','pm','dialog'),(p,'F1','pm','other')]:self.assertEqual(history_reader(db,*args)('PRIVATE-ALPHA')['matches'],0)
if __name__=='__main__':unittest.main()
