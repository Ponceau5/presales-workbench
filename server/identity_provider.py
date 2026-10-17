"""OIDC authentication; project authorization remains in access_control."""
import hashlib,json,os,time,secrets,logging
from urllib.parse import urlencode
from pathlib import Path
import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import Depends,HTTPException,Request,Response
from fastapi.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
import access_control
_config=None
_oauth=None
_checked={}
def enabled():return _config is not None

def provider_get(path,params):
 if not enabled():raise HTTPException(404,'未配置统一登录')
 try:
  response=httpx.get(_config['issuer'].rstrip('/')+path,params={**params,'clientId':_config['client_id'],'clientSecret':_config['client_secret']},timeout=5,trust_env=False)
  response.raise_for_status();body=response.json()
  if isinstance(body,dict) and 'status' in body:
   if body['status']!='ok':raise ValueError('provider error')
   return body['data']
  return body
 except Exception:raise HTTPException(503,'账号服务暂时不可用，请稍后重试') from None

def check_session(value):
 if not enabled():return
 digest=hashlib.sha256(value.encode()).hexdigest()
 with access_control._db() as c:row=c.execute('SELECT l.external_name,l.subject FROM identity_sessions s JOIN identity_links l ON l.subject=s.subject AND l.provider=? WHERE s.token_hash=?',(_config['issuer'],digest)).fetchone()
 if not row:raise HTTPException(401,'请通过统一账号登录')
 key=row['subject']
 if time.monotonic()-_checked.get(key,0)<30:return
 info=provider_get('/api/get-user',{'id':_config['organization']+'/'+row['external_name']})
 if not info or info.get('id')!=key or info.get('isForbidden') or info.get('isDeleted'):
  with access_control._db() as c:c.execute('DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM identity_sessions WHERE subject=?)',(key,))
  _checked.pop(key,None);raise HTTPException(401,'账号已停用，请联系管理员')
 if len(_checked)>10000:_checked.clear()
 _checked[key]=time.monotonic()

def install(app,db,data_dir,actor):
 global _config,_oauth
 path=Path(os.getenv('PRESALES_CASDOOR_CONFIG',str(data_dir/'casdoor-connection.json')))
 if path.exists():
  _config=json.loads(path.read_text())
  required={'issuer','organization','client_id','client_secret','session_secret','callback_url','frontend_url'}
  if not required.issubset(_config) or len(_config['session_secret'])<32:raise RuntimeError('Casdoor 配置不完整')
  app.add_middleware(SessionMiddleware,secret_key=_config['session_secret'],session_cookie='workbench_oidc',same_site='lax',https_only=_config['frontend_url'].startswith('https://'),max_age=600)
  _oauth=OAuth();_oauth.register(name='casdoor',client_id=_config['client_id'],client_secret=_config['client_secret'],server_metadata_url=_config['issuer'].rstrip('/')+'/.well-known/openid-configuration',client_kwargs={'scope':'openid profile','code_challenge_method':'S256'})
 with db() as c:c.executescript('''CREATE TABLE IF NOT EXISTS identity_links(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL,external_name TEXT NOT NULL,PRIMARY KEY(provider,subject),UNIQUE(provider,user_id),FOREIGN KEY(user_id) REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS identity_sessions(token_hash TEXT PRIMARY KEY,subject TEXT NOT NULL,FOREIGN KEY(token_hash) REFERENCES auth_sessions(token_hash) ON DELETE CASCADE);''')
 def login_failure(request,code):
  if 'session' in request.scope:request.session.clear()
  response=RedirectResponse(_config['frontend_url'].rstrip('/')+'/?login_error='+code,303)
  response.delete_cookie('presales_source_session',path='/')
  response.headers['Cache-Control']='no-store'
  return response
 @app.get('/api/auth/config')
 def config():return {'enabled':enabled(),'login_url':'/api/auth/casdoor/login' if enabled() else None,'admin_url':_config['issuer'] if enabled() else None}
 @app.get('/api/auth/casdoor/login')
 async def start(request:Request):
  if not enabled():raise HTTPException(404,'未配置统一登录')
  fresh=request.query_params.get('fresh')=='1' or request.cookies.get('presales_reauth')=='1'
  options={'prompt':'login','max_age':0} if fresh else {}
  try:return await _oauth.casdoor.authorize_redirect(request,_config['callback_url'],**options)
  except Exception:return login_failure(request,'unavailable')
 @app.get('/api/auth/casdoor/callback')
 async def callback(request:Request):
  if not enabled():raise HTTPException(404,'未配置统一登录')
  expected=request.session.get('logout_state')
  if expected and request.query_params.get('state')==expected and not request.query_params.get('code'):
   request.session.clear()
   return RedirectResponse(_config['frontend_url'].rstrip('/')+'/?logged_out=1',303)
  value=None
  try:
   token=await _oauth.casdoor.authorize_access_token(request);info=token.get('userinfo')
   if not info or not info.get('sub'):raise ValueError('missing identity')
   with db() as c:link=c.execute('SELECT user_id FROM identity_links WHERE provider=? AND subject=?',(_config['issuer'],info['sub'])).fetchone()
   if not link and _config.get('trial_self_signup'):
    from trial_signup import link_registered_subject
    registered=link_registered_subject(db,_config,info['sub'],provider_get)
    if registered:link=(registered,)
   if not link:raise HTTPException(403,'账号尚未分配工作台岗位，请联系管理员')
   value,person=access_control.issue_session(link[0])
   with db() as c:c.execute('INSERT INTO identity_sessions VALUES (?,?)',(hashlib.sha256(value.encode()).hexdigest(),info['sub']))
   check_session(value)
  except Exception as error:
   logging.getLogger(__name__).warning('OIDC login failed: %s',type(error).__name__)
   if value:
    digest=hashlib.sha256(value.encode()).hexdigest()
    with db() as c:
     c.execute('DELETE FROM identity_sessions WHERE token_hash=?',(digest,))
     c.execute('DELETE FROM auth_sessions WHERE token_hash=?',(digest,))
   code='unavailable' if isinstance(error,HTTPException) and error.status_code==503 else 'unassigned' if isinstance(error,HTTPException) and error.status_code==403 else 'expired' if type(error).__name__ in {'MismatchingStateError','InvalidClaimError','ExpiredTokenError'} else 'failed'
   return login_failure(request,code)
  response=RedirectResponse(_config['frontend_url'].rstrip('/')+'/?casdoor=1',303)
  response.set_cookie('presales_source_session',value,httponly=True,samesite='lax',secure=_config['frontend_url'].startswith('https://'),max_age=28800,path='/');response.delete_cookie('presales_reauth',path='/');response.headers['Cache-Control']='no-store';return response
 @app.post('/api/auth/casdoor/session')
 def finish(request:Request,response:Response):
  if not enabled():raise HTTPException(404,'未配置统一登录')
  if request.headers.get('origin')!=_config['frontend_url'].rstrip('/'):raise HTTPException(403,'无效登录来源')
  value=request.cookies.get('presales_source_session','');check_session(value);user=access_control.session(value);person=access_control.profile(user);response.headers['Cache-Control']='no-store'
  return {'token':value,'account':user,'person':person}
 @app.post('/api/auth/logout')
 def logout(request:Request,response:Response):
  bearer=request.headers.get('authorization','').removeprefix('Bearer ')
  if enabled() and not bearer and request.headers.get('origin')!=_config['frontend_url'].rstrip('/'):
   raise HTTPException(403,'无效退出来源')
  value=bearer or request.cookies.get('presales_source_session','')
  digest=hashlib.sha256(value.encode()).hexdigest()
  with db() as c:
   c.execute('DELETE FROM identity_sessions WHERE token_hash=?',(digest,))
   c.execute('DELETE FROM auth_sessions WHERE token_hash=?',(digest,))
  response.delete_cookie('presales_source_session',path='/')
  response.headers['Cache-Control']='no-store'
  logout_url=None
  if enabled():
   response.set_cookie('presales_reauth','1',httponly=True,samesite='lax',secure=_config['frontend_url'].startswith('https://'),max_age=86400,path='/')
   if 'session' in request.scope and _config.get('callback_url') and _config.get('client_id'):
    request.session.clear()
    state=secrets.token_urlsafe(32);request.session['logout_state']=state
    logout_url=_config['issuer'].rstrip('/')+'/api/logout?'+urlencode({'client_id':_config['client_id'],'post_logout_redirect_uri':_config['callback_url'],'state':state})
  return {'ok':True,'logout_url':logout_url}
 @app.get('/api/auth/casdoor/accounts')
 def accounts(user:str=Depends(actor)):
  if not access_control.is_admin(user):raise HTTPException(403,'仅管理员可管理账号')
  if not enabled():raise HTTPException(404,'未配置统一登录')
  result=provider_get('/api/get-users',{'owner':_config['organization']})
  with db() as c:linked={r[0] for r in c.execute('SELECT subject FROM identity_links WHERE provider=?',(_config['issuer'],))}
  return [{'id':r['id'],'name':r['name'],'display_name':r['displayName'],'linked':r['id'] in linked,'active':not(r.get('isForbidden') or r.get('isDeleted'))} for r in result]
 @app.post('/api/auth/casdoor/link')
 async def bind(request:Request,user:str=Depends(actor)):
  if not access_control.is_admin(user):raise HTTPException(403,'仅管理员可管理账号')
  payload=await request.json();role=payload.get('role');name=payload.get('name','')
  if role not in access_control.ROLES:raise HTTPException(422,'请选择岗位')
  info=provider_get('/api/get-user',{'id':_config['organization']+'/'+name})
  if not info or info.get('isForbidden') or info.get('isDeleted'):raise HTTPException(422,'账号不存在或已停用')
  identifier='identity_'+info['id']
  with db() as c:
   if c.execute('SELECT 1 FROM identity_links WHERE provider=? AND subject=?',(_config['issuer'],info['id'])).fetchone():raise HTTPException(409,'该账号已经绑定')
   c.execute('INSERT INTO users VALUES (?,?,?,?,?,1,?)',(identifier,info['displayName'],access_control.password_hash(os.urandom(32).hex()),role,int(role=='admin'),access_control.stamp()))
   c.execute('INSERT INTO identity_links VALUES (?,?,?,?)',(_config['issuer'],info['id'],identifier,name));access_control.event(c,user,'identity_linked',{'user_id':identifier,'role':role})
  return {'id':identifier}
