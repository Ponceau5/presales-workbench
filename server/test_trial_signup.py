import sqlite3,unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch,Mock
from fastapi import FastAPI
from fastapi.testclient import TestClient
import trial_signup
class TrialSignupTests(unittest.TestCase):
 def setUp(self):
  self.c=sqlite3.connect(':memory:',check_same_thread=False);self.c.row_factory=sqlite3.Row
  self.c.executescript('CREATE TABLE users(id,display_name,password_hash,role,is_admin,active,created_at); CREATE TABLE identity_links(provider,subject,user_id,external_name); CREATE TABLE identity_sessions(token_hash,subject);')
  @contextmanager
  def db():
   with self.c:yield self.c
  self.db=db;self.config={'issuer':'http://casdoor.test','organization':'workbench','frontend_url':'http://workbench.test','trial_self_signup':True}
  self.info={'id':'new-subject','owner':'workbench','name':'newuser'}
  self.identity=SimpleNamespace(_config=self.config,provider_get=Mock(return_value=self.info))
  app=FastAPI();trial_signup.install(app,db,self.identity);self.client=TestClient(app)
  self.result=Mock();self.result.json.return_value={'status':'ok'}
 def tearDown(self):self.c.close()
 def register(self,**extra):
  with patch.object(trial_signup.httpx,'post',return_value=self.result),patch.object(trial_signup.access_control,'event'),patch.object(trial_signup.access_control,'issue_session',return_value=('token',{})):
   return self.client.post('/api/auth/register',headers={'Origin':self.config['frontend_url']},json={'username':'newuser','password':'demo2026','confirm_password':'demo2026',**extra})
 def test_default_role_is_full_workbench_administrator(self):
  r=self.register();self.assertEqual(r.status_code,200,r.text)
  row=self.c.execute('SELECT role,is_admin FROM users').fetchone();self.assertEqual(tuple(row),('admin',1));self.assertIn('httponly',r.headers['set-cookie'].lower())
 def test_selected_role_is_preserved(self):
  self.assertEqual(self.register(role='sales').status_code,200)
  self.assertEqual(tuple(self.c.execute('SELECT role,is_admin FROM users').fetchone()),('sales',0))
 def test_password_confirmation_and_unknown_role(self):
  self.assertEqual(self.register(confirm_password='different').status_code,422)
  self.assertEqual(self.register(role='root').status_code,422)
  self.assertEqual(self.c.execute('SELECT count(*) FROM users').fetchone()[0],0)
 def test_duplicate_name_is_actionable(self):
  self.result.json.return_value={'status':'error','msg':'The user already exists'}
  self.assertEqual(self.register().status_code,409)
 def test_signup_can_be_disabled(self):
  self.config['trial_self_signup']=False;self.assertEqual(self.register().status_code,404)
 def test_wrong_origin_is_rejected(self):
  r=self.client.post('/api/auth/register',json={'username':'newuser','password':'demo2026','confirm_password':'demo2026'})
  self.assertEqual(r.status_code,403)
 def test_native_signup_links_selected_role(self):
  info={**self.info,'tag':'软件产品','signupApplication':'presales-workbench'}
  with patch.object(trial_signup.access_control,'event'):
   account=trial_signup.link_registered_subject(self.db,self.config,'new-subject',lambda *args:[info])
  self.assertEqual(account,'identity_new-subject')
  self.assertEqual(tuple(self.c.execute('SELECT role,is_admin FROM users').fetchone()),('software',0))
 def test_native_signup_default_admin_and_existing_unassigned_account(self):
  info={**self.info,'tag':'','signupApplication':'presales-workbench'}
  with patch.object(trial_signup.access_control,'event'):
   self.assertIsNotNone(trial_signup.link_registered_subject(self.db,self.config,'new-subject',lambda *args:[info]))
  self.assertEqual(tuple(self.c.execute('SELECT role,is_admin FROM users').fetchone()),('admin',1))
  info['id']='old-user';info['signupApplication']=''
  self.assertIsNone(trial_signup.link_registered_subject(self.db,self.config,'old-user',lambda *args:[info]))
