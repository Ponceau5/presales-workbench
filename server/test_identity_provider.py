"""Identity mapping, project isolation and revoked provider accounts."""
import os,tempfile,unittest,hashlib
from pathlib import Path
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.environ.get('PRESALES_TEST_TMP'))
os.environ['PRESALES_DATA_DIR']=root.name
from fastapi.testclient import TestClient
from fastapi import HTTPException
from app import app,db
import access_control,identity_provider as identity
class IdentityTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.config={'issuer':'http://identity.invalid','organization':'test','frontend_url':'http://127.0.0.1:7101'}
  self.patch=patch.object(identity,'_config',self.config);self.patch.start();identity._checked.clear()
  with db() as c:
   c.execute('INSERT OR IGNORE INTO identity_links VALUES (?,?,?,?)',(self.config['issuer'],'sales-subject','sales','external-sales'))
  self.token,self.person=access_control.issue_session('sales')
  with db() as c:c.execute('INSERT INTO identity_sessions VALUES (?,?)',(hashlib.sha256(self.token.encode()).hexdigest(),'sales-subject'))
 def tearDown(self):self.patch.stop();identity._checked.clear()
 def test_profile_exposes_username_and_keeps_internal_identity(self):
  person=access_control.profile('sales')
  self.assertEqual(person['username'],'external-sales')
  self.assertEqual(person['id'],'sales')
 def test_old_local_login_cannot_bypass_provider(self):
  self.assertEqual(self.c.post('/api/session',json={'username':'pm','password':'demo2026'}).status_code,409)
  local,_=access_control.issue_session('pm')
  self.assertEqual(self.c.get('/api/me',headers={'Authorization':'Bearer '+local}).status_code,401)
 def test_session_finish_requires_origin_and_known_identity(self):
  self.c.cookies.set('presales_source_session',self.token)
  self.assertEqual(self.c.post('/api/auth/casdoor/session').status_code,403)
  with patch.object(identity,'provider_get',return_value={'id':'sales-subject','isAdmin':True}):
   result=self.c.post('/api/auth/casdoor/session',headers={'Origin':self.config['frontend_url']})
  self.assertEqual(result.status_code,200,result.text);self.assertFalse(result.json()['person']['is_admin'])
 def test_disabled_or_recreated_provider_user_revokes_sessions(self):
  for info in [{'id':'sales-subject','isForbidden':True},{'id':'different-subject'}]:
   with patch.object(identity,'provider_get',return_value=info):
    with self.assertRaises(HTTPException):identity.check_session(self.token)
  with self.assertRaises(HTTPException):access_control.session(self.token)
 def test_provider_outage_does_not_allow_session(self):
  with patch.object(identity,'provider_get',side_effect=HTTPException(503,'offline')):
   self.assertEqual(self.c.get('/api/me',headers={'Authorization':'Bearer '+self.token}).status_code,503)
 def test_logout_revokes_session(self):
  self.assertEqual(self.c.post('/api/auth/logout',headers={'Authorization':'Bearer '+self.token}).status_code,200)
  with self.assertRaises(HTTPException):access_control.session(self.token)
if __name__=='__main__':unittest.main()

class LogoutFlowTests(IdentityTests):
 def test_unified_logout_callback_and_fresh_login(self):
  import json
  from urllib.parse import urlsplit,parse_qs
  from unittest.mock import AsyncMock
  from fastapi import FastAPI
  from fastapi.responses import RedirectResponse
  full={**self.config,'client_id':'test-client','client_secret':'test-secret','session_secret':'x'*40,'callback_url':'http://testserver/api/auth/casdoor/callback'}
  directory=Path(root.name)/'logout-config';directory.mkdir(exist_ok=True);(directory/'casdoor-connection.json').write_text(json.dumps(full))
  with patch.object(identity,'_oauth'):
   standalone=FastAPI();identity.install(standalone,db,directory,lambda:'pm');c=TestClient(standalone)
   # An expired workbench session must not force password entry at Casdoor.
   with patch.object(identity._oauth.casdoor,'authorize_redirect',new=AsyncMock(return_value=RedirectResponse('http://identity.invalid/login'))) as ordinary:
    c.get('/api/auth/casdoor/login',follow_redirects=False)
    self.assertEqual(ordinary.call_args.kwargs,{})
   r=c.post('/api/auth/logout',headers={'Authorization':'Bearer '+self.token})
   self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.headers['Cache-Control'],'no-store')
   query=parse_qs(urlsplit(r.json()['logout_url']).query)
   self.assertEqual(query['client_id'],['test-client']);self.assertEqual(query['post_logout_redirect_uri'],[full['callback_url']])
   self.assertNotIn('test-secret',r.text)
   with self.assertRaises(HTTPException):access_control.session(self.token)
   with patch.object(identity._oauth.casdoor,'authorize_redirect',new=AsyncMock(return_value=RedirectResponse('http://identity.invalid/login'))) as redirect:
    c.get('/api/auth/casdoor/login',follow_redirects=False)
    self.assertEqual(redirect.call_args.kwargs,{'prompt':'login','max_age':0})
   result=c.get('/api/auth/casdoor/callback',params={'state':query['state'][0]},follow_redirects=False)
   self.assertEqual(result.status_code,303);self.assertEqual(result.headers['location'],full['frontend_url']+'/?logged_out=1')
 def test_cookie_logout_rejects_other_origin(self):
  self.c.cookies.set('presales_source_session',self.token)
  self.assertEqual(self.c.post('/api/auth/logout',headers={'Origin':'http://other.invalid'}).status_code,403)
  access_control.session(self.token)

class LoginFailureTests(IdentityTests):
 def make_client(self):
  import json
  from fastapi import FastAPI
  full={**self.config,'client_id':'test-client','client_secret':'test-secret','session_secret':'y'*40,'callback_url':'http://testserver/api/auth/casdoor/callback'}
  directory=Path(root.name)/'error-config';directory.mkdir(exist_ok=True);(directory/'casdoor-connection.json').write_text(json.dumps(full))
  standalone=FastAPI();identity.install(standalone,db,directory,lambda:'pm');return TestClient(standalone)
 def test_unassigned_account_returns_to_login_not_blank_error_page(self):
  from unittest.mock import AsyncMock
  with patch.object(identity,'_oauth'):
   c=self.make_client()
   with patch.object(identity._oauth.casdoor,'authorize_access_token',new=AsyncMock(return_value={'userinfo':{'sub':'not-linked'}})):
    response=c.get('/api/auth/casdoor/callback',follow_redirects=False)
  self.assertEqual(response.status_code,303);self.assertEqual(response.headers['location'],self.config['frontend_url']+'/?login_error=unassigned');self.assertEqual(response.headers['cache-control'],'no-store')
 def test_invalid_callback_and_outage_return_to_login(self):
  from unittest.mock import AsyncMock
  with patch.object(identity,'_oauth'):
   c=self.make_client()
   with patch.object(identity._oauth.casdoor,'authorize_access_token',new=AsyncMock(side_effect=ValueError('private-error'))):
    response=c.get('/api/auth/casdoor/callback',follow_redirects=False)
   self.assertEqual(response.status_code,303);self.assertTrue(response.headers['location'].endswith('login_error=failed'));self.assertNotIn('private-error',response.text)
   with patch.object(identity._oauth.casdoor,'authorize_redirect',new=AsyncMock(side_effect=RuntimeError('private-error'))):
    response=c.get('/api/auth/casdoor/login',follow_redirects=False)
   self.assertEqual(response.status_code,303);self.assertTrue(response.headers['location'].endswith('login_error=unavailable'))
 def test_failed_account_check_does_not_leave_new_session(self):
  from unittest.mock import AsyncMock
  with patch.object(identity,'_oauth'):
   c=self.make_client()
   with db() as connection:before=connection.execute('SELECT count(*) FROM auth_sessions').fetchone()[0]
   with patch.object(identity._oauth.casdoor,'authorize_access_token',new=AsyncMock(return_value={'userinfo':{'sub':'sales-subject'}})),patch.object(identity,'check_session',side_effect=HTTPException(503,'offline')):
    response=c.get('/api/auth/casdoor/callback',follow_redirects=False)
   self.assertTrue(response.headers['location'].endswith('login_error=unavailable'))
   with db() as connection:self.assertEqual(connection.execute('SELECT count(*) FROM auth_sessions').fetchone()[0],before)

 def test_expired_authorization_has_distinct_message_code(self):
  from unittest.mock import AsyncMock
  from authlib.integrations.base_client.errors import MismatchingStateError
  with patch.object(identity,'_oauth'):
   c=self.make_client()
   with patch.object(identity._oauth.casdoor,'authorize_access_token',new=AsyncMock(side_effect=MismatchingStateError())):
    response=c.get('/api/auth/casdoor/callback',follow_redirects=False)
   self.assertEqual(response.status_code,303)
   self.assertTrue(response.headers['location'].endswith('login_error=expired'))
