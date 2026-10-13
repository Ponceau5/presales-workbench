"""Identity isolation, ownership conflicts and safe workflow promotion."""
import os,tempfile,json,unittest,copy
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
TEMP=tempfile.TemporaryDirectory(prefix='access-workflow-',dir=os.environ.get('PRESALES_TEST_TMP'))
os.environ['PRESALES_DATA_DIR']=TEMP.name
for prefix in ('ZHIPU','DEEPSEEK','MOONSHOT','SILICONFLOW'):os.environ[prefix+'_API_KEY']=''
from fastapi.testclient import TestClient
from app import app,db
from model_gateway import ModelConfig
class AccessWorkflowTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.admin=self.auth('pm','demo2026');tag=uuid4().hex[:8];self.a='alice_'+tag;self.b='bob_'+tag;self.p='A-'+tag;self.q='B-'+tag
  for user in (self.a,self.b):
   r=self.c.post('/api/access/users',headers=self.admin,json={'username':user,'display_name':user,'role':'sales','password':'testpass2026'});self.assertEqual(r.status_code,200,r.text)
  for project,user in ((self.p,self.a),(self.q,self.b)):
   self.assertEqual(self.c.post('/api/access/projects',headers=self.admin,json={'id':project,'name':project}).status_code,200)
   self.assertEqual(self.c.put('/api/projects/'+project+'/owners',headers=self.admin,json={'role':'sales','user_id':user,'expected_revision':0}).status_code,200)
  self.ah=self.auth(self.a,'testpass2026');self.bh=self.auth(self.b,'testpass2026');self.base='/api/projects/'+self.p+'/workspaces/F7';self.flow=self.base+'/flows'
 def auth(self,user,password):
  r=self.c.post('/api/session',json={'username':user,'password':password});self.assertEqual(r.status_code,200,r.text);return {'Authorization':'Bearer '+r.json()['token']}
 def test_markdown_skill_is_saved_and_used_without_auto_application(self):
  cfg=self.c.get(self.flow,headers=self.ah).json();task=cfg['active']['definition']['tasks'][0]
  self.assertEqual(self.c.post(self.flow+'/taskbook-stream',headers=self.ah,json={}).status_code,404)
  task['taskbook_md']='# Skill\n必须列出版本差异'
  r=self.c.post(self.flow+'/draft',headers=self.ah,json={'expected_revision':0,'base_version_id':cfg['active']['id'],'definition':cfg['active']['definition']})
  self.assertEqual(r.status_code,200,r.text)
  from workflow_studio import instructions
  after=self.c.get(self.flow,headers=self.ah).json();self.assertEqual(after['active']['id'],cfg['active']['id']);self.assertIn('必须列出版本差异',instructions(after['draft'],task['id'],''))
 def test_members_can_trial_separate_skills_but_cannot_override_owner(self):
  self.assertEqual(self.c.put('/api/projects/'+self.p+'/members',headers=self.admin,json={'user_id':self.b}).status_code,200)
  self.assertEqual({p['id'] for p in self.c.get('/api/me',headers=self.bh).json()['projects']},{self.p,self.q})
  self.assertEqual(self.c.get('/api/access/users',headers=self.bh).status_code,403)
  self.assertEqual(self.c.get('/api/projects/'+self.p+'/owners',headers=self.bh).status_code,403)
  cfg=self.c.get(self.flow,headers=self.bh).json();self.assertFalse(cfg['can_apply']);self.assertTrue(cfg['can_edit'])
  cfg['active']['definition']['tasks'][0]['taskbook_md']='# 我的 Skill'
  saved=self.c.post(self.flow+'/draft',headers=self.bh,json={'expected_revision':0,'base_version_id':cfg['active']['id'],'definition':cfg['active']['definition']});self.assertEqual(saved.status_code,200,saved.text)
  self.assertIsNone(self.c.get(self.flow,headers=self.ah).json()['draft'])
  with patch('workspace_router.model_config',return_value=ModelConfig('zhipu','test','mock','key')),patch('workspace_router.request_chat_stream',return_value=iter(['摸排结果'])):
   response=self.c.post(self.base+'/ask-stream',headers=self.bh,json={'question':'测试','task_id':'materials-survey','turn_id':uuid4().hex,'test_run':True,'flow_draft_id':saved.json()['id']})
  self.assertEqual(response.status_code,200,response.text);self.assertIn('"type": "done"',response.text)
  self.assertEqual(self.c.post(self.flow+'/apply',headers=self.bh,json={'draft_id':saved.json()['id'],'expected_binding_revision':cfg['active']['binding_revision']}).status_code,403)
  self.assertEqual(self.c.post(self.base+'/ask-stream',headers=self.bh,json={'question':'正式生成','turn_id':uuid4().hex}).status_code,403)
  self.assertEqual(self.c.post(self.base+'/cost-parameters',headers=self.bh,json={}).status_code,403)
  self.assertEqual(self.c.post('/api/projects/'+self.p+'/documents',headers=self.bh).status_code,403)
 def test_personal_projects_and_sole_ownership(self):
  self.assertEqual(self.c.get('/api/me',headers=self.ah).json()['projects'],[{'id':self.p,'name':self.p}])
  self.assertEqual(self.c.get('/api/projects/'+self.q+'/documents',headers=self.ah).status_code,403)
  self.assertEqual(self.c.get(self.base+'/state',headers=self.bh).status_code,403)
  self.assertEqual(self.c.put('/api/projects/'+self.p+'/owners',headers=self.admin,json={'role':'sales','user_id':self.b,'expected_revision':0}).status_code,409)
  state={'expected_revision':0,'value':{'current':{'conversationId':'private-a','started':True}}}
  self.assertEqual(self.c.post(self.base+'/state',headers=self.ah,json=state).status_code,200)
  with db() as c:self.assertEqual(c.execute('SELECT actor FROM workspace_sessions WHERE project_id=?',(self.p,)).fetchone()[0],self.a)
  r=self.c.put('/api/projects/'+self.p+'/owners',headers=self.admin,json={'role':'sales','user_id':self.b,'expected_revision':1});self.assertEqual(r.status_code,200,r.text)
  self.assertEqual(self.c.get(self.base+'/state',headers=self.ah).status_code,403)
  self.assertIsNone(self.c.get(self.base+'/state',headers=self.bh).json()['value'])
  with db() as c:self.assertEqual(c.execute('SELECT count(*) FROM project_owners WHERE project_id=? AND role=?',(self.p,'sales')).fetchone()[0],1)
 def test_draft_trial_application_and_review(self):
  cfg=self.c.get(self.flow,headers=self.ah).json();definition=copy.deepcopy(cfg['active']['definition']);task=definition['tasks'][1]
  task['require_sources']=False
  for s in task['steps']:
   if s['capability']=='cost':s['enabled']=False
  task['output']='保留原成本模板；列出依据';task['parameters'][1]['default']=80
  body={'expected_revision':0,'base_version_id':cfg['active']['id'],'definition':definition}
  r=self.c.post(self.flow+'/draft',headers=self.ah,json=body);self.assertEqual(r.status_code,200,r.text);draft=r.json()
  self.assertEqual(self.c.post(self.flow+'/draft',headers=self.ah,json=body).status_code,409)
  self.assertEqual(self.c.post(self.flow+'/apply',headers=self.ah,json={'draft_id':draft['id'],'expected_binding_revision':cfg['active']['binding_revision']}).status_code,409)
  with patch('workspace_router.model_config',return_value=ModelConfig('zhipu','test','https://example.invalid','mock')),patch('workspace_router.request_chat_stream',return_value=iter(['核对','结果'])) as model:
   response=self.c.post(self.base+'/ask-stream',headers=self.ah,json={'question':'核对测试流程','task_id':'cost','turn_id':'trial-'+uuid4().hex,'test_run':True,'flow_draft_id':draft['id']})
  self.assertEqual(response.status_code,200,response.text)
  events=[json.loads(x[6:]) for x in response.text.splitlines() if x.startswith('data: ')];trial=next(x['id'] for x in events if x['type']=='trial');self.assertTrue(any(e['type']=='done' for e in events),response.text)
  self.assertIn('保留原成本模板',model.call_args.args[0][0]['content'])
  with db() as c:
   self.assertEqual(c.execute('SELECT count(*) FROM workspace_replies WHERE actor=?',(self.a,)).fetchone()[0],0)
   self.assertEqual(c.execute('SELECT status FROM flow_trials WHERE id=?',(trial,)).fetchone()[0],'completed')
  self.assertEqual(self.c.post(self.flow+'/trials/'+trial+'/verdict',headers=self.ah,json={'accepted':True}).status_code,200)
  submission=self.c.post(self.flow+'/submit',headers=self.ah,json={'draft_id':draft['id'],'expected_binding_revision':cfg['active']['binding_revision']});self.assertEqual(submission.status_code,200,submission.text)
  self.assertEqual(self.c.post(self.flow+'/publish',headers=self.ah,json={'draft_id':draft['id'],'expected_binding_revision':cfg['active']['binding_revision']}).status_code,403)
  self.assertEqual(self.c.post(self.flow+'/apply',headers=self.ah,json={'draft_id':draft['id'],'expected_binding_revision':cfg['active']['binding_revision']}).status_code,200)
  r=self.c.post(self.flow+'/submissions/'+submission.json()['id']+'/review',headers=self.admin,json={'accepted':True});self.assertEqual(r.status_code,200,r.text)
  self.assertEqual(self.c.get(self.flow,headers=self.ah).json()['active']['scope'],self.p)
 def test_invalid_process_and_parameters(self):
  cfg=self.c.get(self.flow,headers=self.ah).json();definition=copy.deepcopy(cfg['active']['definition']);definition['tasks'][1]['steps'].reverse()
  self.assertEqual(self.c.post(self.flow+'/draft',headers=self.ah,json={'expected_revision':0,'base_version_id':cfg['active']['id'],'definition':definition}).status_code,422)
  definition=copy.deepcopy(cfg['active']['definition']);definition['tasks'][1]['parameters'][1].update(min=90,max=100,default=40)
  self.assertEqual(self.c.post(self.flow+'/draft',headers=self.ah,json={'expected_revision':0,'base_version_id':cfg['active']['id'],'definition':definition}).status_code,422)
 def test_shared_state_merges_different_projects_and_blocks_role_override(self):
  initial={'projects':[{'id':self.p,'name':self.p,'snapshot':{'stageStates':{'F5':{'generated':False,'version':1},'F7':{'generated':False,'version':1}}}},{'id':self.q,'name':self.q}], 'activity':[], 'resources':[]}
  revision=self.c.get('/api/workbench/state',headers=self.admin).json()['revision']
  response=self.c.post('/api/workbench/state',headers=self.admin,json={'expected_revision':revision,'value':initial});self.assertEqual(response.status_code,200,response.text)
  a=self.c.get('/api/workbench/state',headers=self.ah).json();b=self.c.get('/api/workbench/state',headers=self.bh).json()
  self.assertEqual([p['id'] for p in a['value']['projects']],[self.p]);self.assertEqual([p['id'] for p in b['value']['projects']],[self.q])
  a['value']['projects'][0]['name']='Alice changed';self.assertEqual(self.c.post('/api/workbench/state',headers=self.ah,json={'expected_revision':a['revision'],'value':a['value']}).status_code,200)
  b=self.c.get('/api/workbench/state',headers=self.bh).json();b['value']['projects'][0]['name']='Bob changed';self.assertEqual(self.c.post('/api/workbench/state',headers=self.bh,json={'expected_revision':b['revision'],'value':b['value']}).status_code,200)
  admin=self.c.get('/api/workbench/state',headers=self.admin).json();self.assertEqual({p['name'] for p in admin['value']['projects']},{'Alice changed','Bob changed'})
  a=self.c.get('/api/workbench/state',headers=self.ah).json();a['value']['projects'][0]['snapshot']['stageStates']['F5']['generated']=True
  self.assertEqual(self.c.post('/api/workbench/state',headers=self.ah,json={'expected_revision':a['revision'],'value':a['value']}).status_code,403)
 def test_edit_after_trial_invalidates_acceptance(self):
  cfg=self.c.get(self.flow,headers=self.ah).json();definition=copy.deepcopy(cfg['active']['definition']);definition['tasks'][1]['require_sources']=False
  for step in definition['tasks'][1]['steps']:
   if step['capability']=='cost':step['enabled']=False
  saved=self.c.post(self.flow+'/draft',headers=self.ah,json={'expected_revision':0,'base_version_id':cfg['active']['id'],'definition':definition}).json()
  with patch('workspace_router.model_config',return_value=ModelConfig('zhipu','test','mock','key')),patch('workspace_router.request_chat_stream',return_value=iter(['output'])):
   r=self.c.post(self.base+'/ask-stream',headers=self.ah,json={'question':'测试','turn_id':uuid4().hex,'task_id':'cost','test_run':True,'flow_draft_id':saved['id']})
  trial=next(json.loads(line[6:])['id'] for line in r.text.splitlines() if line.startswith('data: ') and json.loads(line[6:])['type']=='trial')
  self.assertEqual(self.c.post(self.flow+'/trials/'+trial+'/verdict',headers=self.ah,json={'accepted':True}).status_code,200)
  definition['tasks'][1]['output']='changed';self.assertEqual(self.c.post(self.flow+'/draft',headers=self.ah,json={'expected_revision':1,'base_version_id':cfg['active']['id'],'definition':definition}).status_code,200)
  self.assertEqual(self.c.post(self.flow+'/apply',headers=self.ah,json={'draft_id':saved['id'],'expected_binding_revision':cfg['active']['binding_revision']}).status_code,409)
 def test_cost_parameters_reject_stale_save(self):
  values=self.c.get(self.base+'/cost-parameters',headers=self.ah).json();values['person_days']=50
  r=self.c.post(self.base+'/cost-parameters',headers=self.ah,json=values);self.assertEqual(r.status_code,200,r.text)
  values['person_days']=60
  self.assertEqual(self.c.post(self.base+'/cost-parameters',headers=self.ah,json=values).status_code,409)
  self.assertEqual(self.c.get(self.base+'/cost-parameters',headers=self.ah).json()['person_days'],50)
 def test_skill_markdown_replaces_parameter_list_and_keeps_tools(self):
  cfg=self.c.get(self.flow,headers=self.ah).json();task=cfg['active']['definition']['tasks'][1]
  parsed={'name':'成本表','prompt':'请生成成本表','parameters':[{'key':'person_days','label':'调试人天','type':'number','default':60,'unit':'天','min':0,'max':None,'required':True,'purpose':'调试成本'},{'key':'reserve','label':'预留费用','type':'number','default':500,'unit':'元','min':0,'max':None,'required':True,'purpose':'额外预留'}]}
  with patch('model_gateway.model_config',return_value=ModelConfig('zhipu','test','mock','key')),patch('model_gateway.request_chat_stream',return_value=iter([json.dumps(parsed)])):
   r=self.c.post(self.flow+'/skill',headers=self.ah,json={'definition':cfg['active']['definition'],'task_id':'cost','markdown':'# 成本表\n调试60天，预留费用500元；删除其他参数','expected_revision':0,'base_version_id':cfg['active']['id']})
  self.assertEqual(r.status_code,200,r.text);self.assertEqual([p['key'] for p in r.json()['task']['parameters']],['person_days','reserve']);self.assertEqual(r.json()['task']['steps'],task['steps'])
  self.assertEqual(self.c.get(self.flow,headers=self.ah).json()['active']['id'],cfg['active']['id'])
 def test_rename_preserves_password_ownership_and_invalidates_old_session(self):
  name='renamed_'+uuid4().hex[:8]
  r=self.c.post('/api/access/users/'+self.a+'/rename',headers=self.admin,json={'username':name});self.assertEqual(r.status_code,200,r.text)
  self.assertEqual(self.c.get('/api/me',headers=self.ah).status_code,401)
  new=self.auth(name,'testpass2026');self.assertEqual(self.c.get('/api/me',headers=new).json()['projects'][0]['id'],self.p)
  with db() as c:self.assertEqual(c.execute('SELECT user_id FROM project_owners WHERE project_id=? AND role=?',(self.p,'sales')).fetchone()[0],name)
 def test_upload_template_is_classified_and_used_only_for_format(self):
  r=self.c.post('/api/projects/'+self.p+'/documents',headers=self.ah,data={'title':'成本样本','version':'V1'},files={'file':('template.md',b'# template\nPrice example 9999','text/markdown')});self.assertEqual(r.status_code,200,r.text);identifier=r.json()['id']
  material=self.base+'/materials'
  r=self.c.post(material+'/classify',headers=self.ah,json={'document_id':identifier,'category':'template'});self.assertEqual(r.status_code,200,r.text)
  catalog=self.c.get(material,headers=self.ah).json();self.assertTrue(any(d['id']==identifier for d in catalog['templates']));self.assertFalse(any(d['id']==identifier for d in catalog['inputs']))
  with patch('workspace_router.model_config',return_value=ModelConfig('zhipu','test','mock','key')),patch('workspace_router.request_chat_stream',return_value=iter(['资料摸排'])) as model:
   response=self.c.post(self.base+'/ask-stream',headers=self.ah,json={'question':'资料摸排','task_id':'materials-survey','turn_id':uuid4().hex,'selected_pages':[{'document_id':identifier,'page':1}]})
  self.assertEqual(response.status_code,200,response.text);self.assertIn('仅参考表格格式',model.call_args.args[0][1]['content'])
 def test_materials_show_versions_and_compare_only_same_project(self):
  material=self.base+'/materials'
  with db() as c:
   for version in (1,2):c.execute('INSERT INTO workspace_artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?)',(self.p+str(version),self.p,'F7','origin','成本表','成本 '+str(version),version,self.a,'dialog','[]','2026-10-12'))
   c.execute('INSERT INTO workspace_artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?)',('upstream-'+self.p,self.p,'F3','origin','配置清单','已确认配置',1,self.a,'dialog','[]','2026-10-12'))
  catalog=self.c.get(material,headers=self.ah).json();self.assertEqual(len(catalog['outputs']),2);self.assertTrue(any(v['kind']=='upstream' for v in catalog['inputs']))
  with patch('workspace_materials.model_config',return_value=ModelConfig('zhipu','test','mock','key')),patch('workspace_materials.request_chat_stream',return_value=iter(['金额增加1'])) as model:
   r=self.c.post(material+'/compare-stream',headers=self.ah,json={'current_id':self.p+'2','previous_id':self.p+'1'})
  self.assertEqual(r.status_code,200,r.text);self.assertIn('金额增加1',r.text);self.assertIn('成本 1',model.call_args.args[0][1]['content'])
  self.assertEqual(self.c.post(material+'/compare-stream',headers=self.bh,json={'current_id':self.p+'2','previous_id':self.p+'1'}).status_code,403)
 def test_disable_account_revokes_sessions(self):
  self.assertEqual(self.c.patch('/api/access/users/'+self.a,headers=self.admin,json={'active':False}).status_code,200)
  self.assertEqual(self.c.get('/api/me',headers=self.ah).status_code,401)
if __name__=='__main__':unittest.main()
