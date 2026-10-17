"""Personal identities and project/role ownership; all policy checks run server-side."""
import hashlib,hmac,secrets,json,re,time
from datetime import datetime,timezone
from fastapi import Depends,HTTPException
from pydantic import BaseModel,Field
_db=None
ROLES={'sales':'销售','solution':'解决方案','hardware':'硬件产品','software':'软件产品','commercial':'商务支持','finance':'财务 / 风控','logistics':'货运关务','dev':'研发','legal':'认证 / 法务','admin':'系统管理员'}
STAGES={'F1':{'sales','commercial'},'F2':{'solution','software'},'F3':{'solution'},'F4':{'hardware'},'F5':{'software','solution'},'F6':{'logistics','legal'},'F7':{'sales','finance'},'F8':{'sales','solution'},'F9':{'commercial','finance'},'F10':{'sales','commercial'},'F11':{'sales','commercial'},'F12':{'legal'},'F13':{'finance'}}
def stamp():return datetime.now(timezone.utc).isoformat()
def password_hash(value):
 salt=secrets.token_hex(16);return salt+':'+hashlib.pbkdf2_hmac('sha256',value.encode(),bytes.fromhex(salt),260000).hex()
def verify(value,stored):
 salt,digest=stored.split(':');return hmac.compare_digest(hashlib.pbkdf2_hmac('sha256',value.encode(),bytes.fromhex(salt),260000).hex(),digest)
def init(db,password):
 global _db;_db=db
 with db() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, display_name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS access_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS project_owners(project_id TEXT NOT NULL,role TEXT NOT NULL,user_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(project_id,role),FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS project_members(project_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(project_id,user_id),FOREIGN KEY(project_id) REFERENCES access_projects(id),FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS access_events(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);''')
  first=c.execute('SELECT count(*) FROM users').fetchone()[0]==0
  if first:
   for role,name in ROLES.items():c.execute('INSERT INTO users VALUES (?,?,?,?,?,1,?)',('pm' if role=='admin' else role,'系统管理员' if role=='admin' else name+'（原演示账号）',password_hash(password),role,int(role=='admin'),stamp()))
   for project,name in [('GSA02','泰国 GSA02'),('RCJM1','Racks Central'),('DEMO-026','数据中心二期')]:
    c.execute('INSERT OR IGNORE INTO access_projects VALUES (?,?)',(project,name))
    for role in ROLES:
     if role!='admin':c.execute('INSERT OR IGNORE INTO project_owners VALUES (?,?,?,1)',(project,role,role))
  if first:
   for row in c.execute('SELECT DISTINCT project_id FROM documents').fetchall():c.execute('INSERT OR IGNORE INTO access_projects VALUES (?,?)',(row[0],row[0]))
   if c.execute("SELECT 1 FROM sqlite_master WHERE name='workspace_sessions'").fetchone():
    for row in c.execute('SELECT DISTINCT project_id FROM workspace_sessions').fetchall():c.execute('INSERT OR IGNORE INTO access_projects VALUES (?,?)',(row[0],row[0]))
  c.execute("UPDATE users SET role='admin',is_admin=1,display_name=CASE WHEN id='pm' THEN '系统管理员' ELSE display_name END WHERE role='pm'")
  c.execute("DELETE FROM project_owners WHERE role='pm'")
def profile(user):
 with _db() as c:
  r=c.execute('SELECT id,display_name,role,is_admin,active FROM users WHERE id=?',(str(user),)).fetchone()
  if not r or not r['active']:raise HTTPException(401,'账号已停用，请重新登录')
  projects=c.execute('SELECT id,name FROM access_projects' if r['is_admin'] else 'SELECT DISTINCT p.id,p.name FROM access_projects p WHERE p.id IN (SELECT project_id FROM project_owners WHERE user_id=? UNION SELECT project_id FROM project_members WHERE user_id=?) ORDER BY p.id',() if r['is_admin'] else (str(user),str(user))).fetchall()
  link=c.execute('SELECT external_name FROM identity_links WHERE user_id=? LIMIT 1',(str(user),)).fetchone() if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='identity_links'").fetchone() else None
  username=link['external_name'] if link else (r['display_name'] if r['id'].startswith('identity_') else r['id'])
  return {**dict(r),'username':username,'role_name':ROLES[r['role']],'projects':[dict(p) for p in projects]}
def role_of(user):return profile(user)['role'] if _db else str(user)
def is_admin(user):return bool(profile(user)['is_admin']) if _db else str(user)=='pm'
def allowed_projects(user):return {p['id'] for p in profile(user)['projects']}
def check_project(user,project):
 if _db is None:return
 if is_admin(user):return
 if project not in allowed_projects(user):raise HTTPException(403,'你没有此项目的访问权限')
def check_owner(user,project,role):
 if _db is None:return
 if is_admin(user):return
 with _db() as c:r=c.execute('SELECT user_id FROM project_owners WHERE project_id=? AND role=?',(project,role)).fetchone()
 if not r or r[0]!=str(user):raise HTTPException(403,'请由本项目该岗位负责人操作')
def event(c,user,action,detail):c.execute('INSERT INTO access_events VALUES (?,?,?,?,?)',(secrets.token_hex(16),str(user),action,json.dumps(detail,ensure_ascii=False),stamp()))
def login(user,password):
 with _db() as c:r=c.execute('SELECT * FROM users WHERE id=? AND active=1',(user,)).fetchone()
 if not r or not verify(password,r['password_hash']):raise HTTPException(401,'账号或密码不正确')
 return issue_session(user)
def issue_session(user):
 profile(user)
 token=secrets.token_urlsafe(32)
 with _db() as c:c.execute('INSERT INTO auth_sessions VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user,time.time()+28800))
 return token,profile(user)
def session(token):
 with _db() as c:r=c.execute('SELECT user_id FROM auth_sessions WHERE token_hash=? AND expires>?',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
 if not r:raise HTTPException(401,'请先登录')
 profile(r[0]);return r[0]
def authorize(user,request):
 path=request.url.path;project=request.path_params.get('project_id') or request.query_params.get('project_id')
 if not project:
  match=re.match(r'/api/projects/([^/]+)',path)
  if match:project=match[1]
 if path.startswith('/api/requirements/') or path.startswith('/api/handoffs/'):
  table='requirements' if path.startswith('/api/requirements/') else 'handoffs'
  with _db() as c:r=c.execute('SELECT project_id FROM '+table+' WHERE id=?',(path.split('/')[3],)).fetchone()
  if r:project=r[0]
 if path.startswith('/api/role-config/software/samples/'):
  with _db() as c:r=c.execute('SELECT project_id FROM role_file_samples WHERE id=?',(path.split('/')[5],)).fetchone()
  if r:project=r[0]
 if path.startswith('/api/documents/'):
  identifier=path.split('/')[3]
  with _db() as c:r=c.execute('SELECT project_id FROM documents WHERE id=?',(identifier,)).fetchone()
  if r:project=r[0]
 if not project:return
 # Existing local intake can create a new empty project, never take over an existing one.
 with _db() as c:exists=c.execute('SELECT 1 FROM access_projects WHERE id=?',(project,)).fetchone()
 if not exists and request.method=='POST' and path.endswith('/documents') and role_of(user) in {'sales','software','admin'}:
  with _db() as c:
   c.execute('INSERT OR IGNORE INTO access_projects VALUES (?,?)',(project,project));c.execute('INSERT OR IGNORE INTO project_owners VALUES (?,?,?,1)',(project,role_of(user),user))
 check_project(user,project)
 if request.method!='GET' and not request.path_params.get('stage_id') and not path.endswith('/read'):
  check_owner(user,project,role_of(user))
 stage=request.path_params.get('stage_id')
 if request.method!='GET' and stage and not path.endswith(('/state','/read')) and not '/flows' in path:
  if not is_admin(user) and role_of(user) not in STAGES.get(stage,set()):raise HTTPException(403,'当前岗位不能修改此工作区')
  if not path.endswith(('/ask-stream','/compare-stream')):check_owner(user,project,role_of(user))
class NewUser(BaseModel):
 username:str=Field(pattern=r'^[a-z][a-z0-9_-]{2,39}$')
 display_name:str=Field(min_length=1,max_length=80)
 password:str=Field(min_length=8,max_length=128)
 role:str
class RenameUser(BaseModel):
 username:str=Field(pattern=r'^[a-z][a-z0-9_-]{1,39}$')
class Membership(BaseModel):
 user_id:str
 visible:bool=True
class Owner(BaseModel):
 role:str
 user_id:str
 expected_revision:int=Field(ge=0)
 retain_previous_access:bool|None=None
class ActiveUser(BaseModel):
 active:bool
class UserProfile(BaseModel):
 display_name:str=Field(min_length=1,max_length=80)
 role:str
class NewProject(BaseModel):
 id:str=Field(pattern=r'^[A-Za-z0-9_-]{1,60}$')
 name:str=Field(min_length=1,max_length=100)
def effective_project_access(user,project,owners,members):
 owned=[o['role'] for o in owners if o['project_id']==project and o['user_id']==user['id']]
 direct=any(m['project_id']==project and m['user_id']==user['id'] for m in members)
 admin=bool(user['is_admin']);visible=admin or bool(owned) or direct
 active=bool(user['active']) and visible
 return {'assigned':visible,'source':'admin' if admin else 'owner' if owned else 'member' if direct else 'none','owner_roles':owned,
         'read':active,'trial':active and (admin or any(user['role'] in roles for stage,roles in STAGES.items() if stage!='F5')),
         'apply':active and (admin or any(role in owned for roles in STAGES.values() for role in roles)),'publish':active and admin,
         'process_stages':[stage for stage,roles in STAGES.items() if active and (admin or user['role'] in owned and user['role'] in roles)]}

def install(app,actor):
 def admin(user):
  if not is_admin(user):raise HTTPException(403,'仅管理员可管理账号与负责人')
 @app.get('/api/me')
 def me(user:str=Depends(actor)):return profile(user)
 @app.get('/api/access/overview')
 def overview(user:str=Depends(actor)):
  admin(user)
  with _db() as c:
   people=[dict(r) for r in c.execute('SELECT id,display_name,role,is_admin,active FROM users ORDER BY created_at')]
   projects=[dict(r) for r in c.execute('SELECT id,name FROM access_projects ORDER BY name')]
   owners=[dict(r) for r in c.execute('SELECT * FROM project_owners')]
   members=[dict(r) for r in c.execute('SELECT * FROM project_members')]
   permissions={u['id']:{p['id']:effective_project_access(u,p['id'],owners,members) for p in projects} for u in people}
   return {'users':people,'projects':projects,'owners':owners,'members':members,'roles':ROLES,'role_stages':{role:[stage for stage,roles in STAGES.items() if role=='admin' or role in roles] for role in ROLES},'permissions':permissions}
 @app.get('/api/access/users')
 def users(user:str=Depends(actor)):
  admin(user)
  with _db() as c:return [dict(r) for r in c.execute('SELECT id,display_name,role,is_admin,active FROM users ORDER BY created_at')]
 @app.get('/api/access/events')
 def events(user:str=Depends(actor)):
  admin(user)
  actions=('user_created','user_active_changed','user_renamed','user_profile_changed','owner_assigned','project_visibility_changed','project_created','identity_linked')
  with _db() as c:return [dict(r) for r in c.execute('SELECT * FROM access_events WHERE action IN ('+','.join('?' for _ in actions)+') ORDER BY created_at DESC,rowid DESC LIMIT 100',actions)]
 @app.patch('/api/access/users/{identifier}/profile')
 def edit_profile(identifier:str,payload:UserProfile,user:str=Depends(actor)):
  admin(user)
  if payload.role not in ROLES:raise HTTPException(422,'岗位不存在')
  with _db() as c:
   c.execute('BEGIN IMMEDIATE')
   old=c.execute('SELECT display_name,role FROM users WHERE id=?',(identifier,)).fetchone()
   if not old:raise HTTPException(404,'账号不存在')
   if old['role']!=payload.role and c.execute('SELECT 1 FROM project_owners WHERE user_id=?',(identifier,)).fetchone():raise HTTPException(409,'请先转交该用户的项目负责人职责，再调整岗位')
   c.execute('UPDATE users SET display_name=?,role=?,is_admin=? WHERE id=?',(payload.display_name,payload.role,int(payload.role=='admin'),identifier))
   if old['role']!=payload.role:c.execute('DELETE FROM auth_sessions WHERE user_id=?',(identifier,))
   event(c,user,'user_profile_changed',{'id':identifier,'previous':dict(old),**payload.model_dump()})
  return {'id':identifier}
 @app.post('/api/access/users')
 def create(payload:NewUser,user:str=Depends(actor)):
  admin(user)
  import identity_provider
  if identity_provider.enabled():raise HTTPException(409,'请在统一账号管理中创建账号')
  if payload.role not in ROLES:raise HTTPException(422,'岗位不存在')
  with _db() as c:
   if c.execute('SELECT 1 FROM users WHERE id=?',(payload.username,)).fetchone():raise HTTPException(409,'账号已存在')
   c.execute('INSERT INTO users VALUES (?,?,?,?,?,1,?)',(payload.username,payload.display_name,password_hash(payload.password),payload.role,int(payload.role=='admin'),stamp()));event(c,user,'user_created',{'id':payload.username,'role':payload.role})
  return {'id':payload.username}
 @app.post('/api/access/users/{identifier}/rename')
 def rename_user(identifier:str,payload:RenameUser,user:str=Depends(actor)):
  admin(user)
  with _db() as c:
   c.execute('BEGIN IMMEDIATE');c.execute('PRAGMA defer_foreign_keys=ON')
   if not c.execute('SELECT 1 FROM users WHERE id=?',(identifier,)).fetchone():raise HTTPException(404,'账号不存在')
   if c.execute('SELECT 1 FROM users WHERE id=?',(payload.username,)).fetchone():raise HTTPException(409,'新账号名已存在')
   c.execute('DELETE FROM auth_sessions WHERE user_id=?',(identifier,))
   c.execute('UPDATE users SET id=?,display_name=? WHERE id=?',(payload.username,payload.username,identifier))
   fields={'user_id','actor','author','adopted_by','created_by','reviewed_by','account','account_id','sender','recipient'}
   tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
   for table in tables:
    columns=[r[1] for r in c.execute('PRAGMA table_info("'+table+'")')]
    for column in fields.intersection(columns):c.execute('UPDATE "'+table+'" SET "'+column+'"=? WHERE "'+column+'"=?',(payload.username,identifier))
   identity_keys={'accountId','actor','createdBy','reviewedBy','adoptedBy','author','user_id','account_id','sender','recipient'}
   def identities(value):
    if isinstance(value,dict):return {k:payload.username if k in identity_keys and isinstance(v,str) and v==identifier else identities(v) for k,v in value.items()}
    if isinstance(value,list):return [identities(v) for v in value]
    return value
   for table,fields_to_update in [('shared_workbench_state',['value']),('workspace_sessions',['value']),('workspace_dialogues',['value'])]:
    if table not in tables:continue
    for row in c.execute('SELECT rowid AS record_rowid,* FROM "'+table+'"').fetchall():
     for column in fields_to_update:
      old=json.loads(row[column]);new=identities(old)
      if new!=old:c.execute('UPDATE "'+table+'" SET "'+column+'"=? WHERE rowid=?',(json.dumps(new,ensure_ascii=False),row['record_rowid']))
   event(c,user,'user_renamed',{'previous':identifier,'current':payload.username})
  return {'id':payload.username}
 @app.patch('/api/access/users/{identifier}')
 def change_user(identifier:str,payload:ActiveUser,user:str=Depends(actor)):
  admin(user)
  if identifier==user and not payload.active:raise HTTPException(422,'不能停用当前管理员账号')
  with _db() as c:
   if not c.execute('SELECT 1 FROM users WHERE id=?',(identifier,)).fetchone():raise HTTPException(404,'人员不存在')
   c.execute('UPDATE users SET active=? WHERE id=?',(int(payload.active),identifier));c.execute('DELETE FROM auth_sessions WHERE user_id=?',(identifier,));event(c,user,'user_active_changed',{'id':identifier,'active':payload.active})
  return {'active':payload.active}
 @app.post('/api/access/projects')
 def create_project(payload:NewProject,user:str=Depends(actor)):
  admin(user)
  with _db() as c:
   if c.execute('SELECT 1 FROM access_projects WHERE id=?',(payload.id,)).fetchone():raise HTTPException(409,'项目已存在')
   c.execute('INSERT INTO access_projects VALUES (?,?)',(payload.id,payload.name));event(c,user,'project_created',payload.model_dump())
  return payload.model_dump()
 @app.get('/api/projects/{project_id}/owners')
 def owners(project_id:str,user:str=Depends(actor)):
  admin(user)
  with _db() as c:return [dict(r) for r in c.execute('SELECT o.*,u.display_name FROM project_owners o JOIN users u ON u.id=o.user_id WHERE project_id=?',(project_id,))]
 @app.put('/api/projects/{project_id}/members')
 def member(project_id:str,payload:Membership,user:str=Depends(actor)):
  admin(user)
  with _db() as c:
   if not c.execute('SELECT 1 FROM access_projects WHERE id=?',(project_id,)).fetchone():raise HTTPException(404,'项目不存在')
   if not c.execute('SELECT 1 FROM users WHERE id=? AND active=1',(payload.user_id,)).fetchone():raise HTTPException(422,'账号不存在或已停用')
   if payload.visible:c.execute('INSERT OR IGNORE INTO project_members VALUES (?,?)',(project_id,payload.user_id))
   else:c.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?',(project_id,payload.user_id))
   event(c,user,'project_visibility_changed',{'project':project_id,**payload.model_dump()})
  return {'visible':payload.visible}
 @app.put('/api/projects/{project_id}/owners')
 def assign(project_id:str,payload:Owner,user:str=Depends(actor)):
  admin(user)
  with _db() as c:
   c.execute('BEGIN IMMEDIATE')
   target=c.execute('SELECT role,active FROM users WHERE id=?',(payload.user_id,)).fetchone()
   if not target or not target['active'] or target['role']!=payload.role:raise HTTPException(422,'人员岗位与负责人岗位不匹配')
   if not c.execute('SELECT 1 FROM access_projects WHERE id=?',(project_id,)).fetchone():raise HTTPException(404,'项目不存在')
   old=c.execute('SELECT user_id,revision FROM project_owners WHERE project_id=? AND role=?',(project_id,payload.role)).fetchone();revision=old['revision'] if old else 0
   if revision!=payload.expected_revision:raise HTTPException(409,'负责人已被调整，请刷新后再确认')
   if old and old['user_id']!=payload.user_id and payload.retain_previous_access is not None:
    if payload.retain_previous_access:c.execute('INSERT OR IGNORE INTO project_members VALUES (?,?)',(project_id,old['user_id']))
    else:c.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?',(project_id,old['user_id']))
   c.execute('INSERT INTO project_owners VALUES (?,?,?,?) ON CONFLICT(project_id,role) DO UPDATE SET user_id=excluded.user_id,revision=excluded.revision',(project_id,payload.role,payload.user_id,revision+1));event(c,user,'owner_assigned',{'project':project_id,'previous_user_id':old['user_id'] if old else None,**payload.model_dump()})
  return {'revision':revision+1}

def filter_shared(value,user):
 if not value:return value
 allowed=allowed_projects(user)
 result={}
 for key,items in value.items():
  if not isinstance(items,list):result[key]=items;continue
  result[key]=[r for r in items if not isinstance(r,dict) or (r.get('id') in allowed if key=='projects' else not (r.get('projectId') or r.get('project_id')) or (r.get('projectId') or r.get('project_id')) in allowed)]
 return result

def merge_shared(old,proposed,user,connection=None):
 if is_admin(user):
  c=connection
  if c is not None:
   for p in proposed.get('projects',[]):c.execute('INSERT OR IGNORE INTO access_projects VALUES (?,?)',(p['id'],p.get('name',p['id'])))
  return proposed
 allowed=allowed_projects(user);old=old or {};merged=dict(old)
 for key,items in proposed.items():
  if not isinstance(items,list):raise HTTPException(403,'无权修改全局配置')
  incoming=[]
  for r in items:
   project=r.get('id') if key=='projects' else r.get('projectId') or r.get('project_id') if isinstance(r,dict) else None
   if project and project not in allowed:raise HTTPException(403,'无权修改其他项目状态')
   if project and key=='projects':
    old_project=next((v for v in old.get('projects',[]) if v.get('id')==project),{})
    before=old_project.get('snapshot') or {};after=r.get('snapshot') or {}
    for stage,content in (after.get('stageStates') or {}).items():
     if role_of(user) in STAGES.get(stage,set()):continue
     previous=(before.get('stageStates') or {}).get(stage)
     if previous is not None:
      strip=lambda value:{k:v for k,v in value.items() if k not in {'change','assigned'}}
      if strip(previous)!=strip(content):raise HTTPException(403,'无权修改其他岗位的工作状态')
     elif content.get('written') or content.get('generated') or content.get('version',1)>1 or any(row.get('status','waiting')!='waiting' for row in content.get('rows',[])):raise HTTPException(403,'不能创建其他岗位的已审核状态')
    for field in ('rows','facts','clarified','modelConfirmed'):
     if field in before and after.get(field)!=before[field] and role_of(user)!='software':raise HTTPException(403,'当前岗位不能修改软件核对数据')
   if project:
    with _db() as owner_db:owner=owner_db.execute('SELECT user_id FROM project_owners WHERE project_id=? AND role=?',(project,role_of(user))).fetchone()
    previous=next((v for v in old.get(key,[]) if (v.get('id') if key=='projects' else v.get('projectId') or v.get('project_id'))==project),None)
    if not owner or owner[0]!=str(user):
     if r!=previous:raise HTTPException(403,'当前项目仅可查看，正式修改请由岗位负责人操作')
    incoming.append(r)
  prior=old.get(key,[])
  for previous in prior:
   project=previous.get('id') if key=='projects' else previous.get('projectId') or previous.get('project_id') if isinstance(previous,dict) else None
   if project in allowed and previous not in incoming:
    with _db() as owner_db:owner=owner_db.execute('SELECT user_id FROM project_owners WHERE project_id=? AND role=?',(project,role_of(user))).fetchone()
    if not owner or owner[0]!=str(user):incoming.append(previous)
  preserved=[r for r in prior if (r.get('id') if key=='projects' else r.get('projectId') or r.get('project_id') if isinstance(r,dict) else None) not in allowed]
  merged[key]=preserved+incoming
 return merged
