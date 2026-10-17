"""Cross-workspace references, history and human publication."""
from test_access_workflows import AccessWorkflowTests,db
from uuid import uuid4
class MaterialReadinessTests(AccessWorkflowTests):
 def test_shared_template_and_history(self):
  r=self.c.post('/api/projects/'+self.p+'/documents',headers=self.ah,data={'title':'共享模板','version':'V1'},files={'file':('template.md',b'# layout','text/markdown')});self.assertEqual(r.status_code,200,r.text);identifier=r.json()['id']
  for stage in ('F7','F8'):
   r=self.c.post('/api/projects/'+self.p+'/workspaces/'+stage+'/materials/classify',headers=self.ah,json={'document_id':identifier,'category':'template'});self.assertEqual(r.status_code,200,r.text)
  for stage in ('F7','F8'):
   self.assertIn(identifier,[r['id'] for r in self.c.get('/api/projects/'+self.p+'/workspaces/'+stage+'/materials',headers=self.ah).json()['templates']])
  self.assertEqual(self.c.get('/api/documents/'+identifier+'/download',headers=self.ah).content,b'# layout')
  with db() as c:
   for rev in (1,2):c.execute('INSERT INTO workspace_artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?)',(self.p+'-up'+str(rev),self.p,'F3','origin','配置清单','配置'+str(rev),rev,self.a,'dialog','[]','2026-10-16'))
  rows=self.c.get(self.base+'/materials',headers=self.ah).json()['inputs']
  self.assertEqual([r['revision'] for r in rows if r['title']=='配置清单'],[2,1])
 def test_human_publication_notifies_once(self):
  identifier=uuid4().hex
  with db() as c:c.execute('INSERT INTO workspace_replies VALUES (?,?,?,?,?,?,?,?,?)',(identifier,self.p,'F3','pm','已核对设备清单','[]','2026-10-16',None,None))
  body={'source_id':identifier,'title':'配置清单','content':'已核对设备清单','conversation_id':'test'};endpoint='/api/projects/'+self.p+'/workspaces/F3/artifacts/adopt'
  first=self.c.post(endpoint,headers=self.admin,json=body);self.assertEqual(first.status_code,200,first.text)
  self.assertEqual(self.c.post(endpoint,headers=self.admin,json=body).json()['id'],first.json()['id'])
  for stage in ('F7','F8'):
   r=self.c.get('/api/projects/'+self.p+'/workspaces/'+stage+'/collaboration',headers=self.ah);self.assertEqual(r.status_code,200,r.text)
   self.assertEqual(sum(m['artifact_id']==first.json()['id'] for m in r.json()),1)
  with db() as c:self.assertEqual(c.execute('SELECT count(*) FROM workspace_replies WHERE project_id=?',(self.p,)).fetchone()[0],1)
