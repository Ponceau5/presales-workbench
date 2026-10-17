"""Trial registration through Casdoor; role defaults are explicit configuration."""
import hashlib, json, os, re
from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field
import httpx
import access_control

class Signup(BaseModel):
    username:str=Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{2,39}$')
    password:str=Field(min_length=6,max_length=128)
    confirm_password:str=Field(min_length=6,max_length=128)
    role:str='admin'

def provision(db,config,info,role):
    if role not in access_control.ROLES:raise HTTPException(422,'请选择有效角色')
    if not info or not info.get('id') or info.get('owner')!=config['organization'] or info.get('isForbidden') or info.get('isDeleted'):raise HTTPException(403,'注册账号无效')
    identifier='identity_'+info['id']
    with db() as c:
        link=c.execute('SELECT user_id FROM identity_links WHERE provider=? AND subject=?',(config['issuer'],info['id'])).fetchone()
        if link:return link[0]
        c.execute('INSERT INTO users VALUES (?,?,?,?,?,1,?)',(identifier,info.get('displayName') or info['name'],access_control.password_hash(os.urandom(32).hex()),role,int(role=='admin'),access_control.stamp()))
        c.execute('INSERT INTO identity_links VALUES (?,?,?,?)',(config['issuer'],info['id'],identifier,info['name']))
        access_control.event(c,identifier,'trial_account_registered',{'role':role,'external_name':info['name']})
    return identifier

def link_registered_subject(db,config,subject,provider_get):
    if not config.get('trial_self_signup'):return None
    users=provider_get('/api/get-users',{'owner':config['organization']})
    info=next((u for u in users if u.get('id')==subject),None)
    if not info or info.get('signupApplication')!=config.get('application','presales-workbench'):return None
    role=next((key for key,label in access_control.ROLES.items() if label==info.get('tag')),None)
    if role is None:
        if info.get('tag'):raise HTTPException(422,'注册角色无效，请联系管理员')
        role='admin'
    return provision(db,config,info,role)

def install(app,db,identity):
    @app.post('/api/auth/register')
    def register(payload:Signup,request:Request,response:Response):
        config=identity._config
        if not config or not config.get('trial_self_signup'):raise HTTPException(404,'当前未开放自行注册')
        if request.headers.get('origin')!=config['frontend_url'].rstrip('/'):raise HTTPException(403,'无效注册来源')
        if payload.password!=payload.confirm_password:raise HTTPException(422,'两次输入的密码不一致')
        if payload.role not in access_control.ROLES:raise HTTPException(422,'请选择有效角色')
        body={'application':config.get('application','presales-workbench'),'organization':config['organization'],'username':payload.username,'name':payload.username,'password':payload.password,'confirm':payload.confirm_password,'tag':access_control.ROLES[payload.role],'agreement':True}
        try:
            result=httpx.post(config['issuer'].rstrip('/')+'/api/signup',json=body,timeout=15,trust_env=False)
            result.raise_for_status();result=result.json()
        except (httpx.HTTPError,ValueError):raise HTTPException(503,'账号服务暂时不可用，请稍后重试') from None
        if result.get('status')!='ok':
            message=str(result.get('msg','注册失败'))
            if re.search(r'exist|已存在',message,re.I):raise HTTPException(409,'用户名已存在，请换一个用户名')
            raise HTTPException(422,'注册未完成，请检查用户名和密码是否符合要求')
        info=identity.provider_get('/api/get-user',{'id':config['organization']+'/'+payload.username})
        account=provision(db,config,info,payload.role)
        token,_=access_control.issue_session(account)
        with db() as c:c.execute('INSERT INTO identity_sessions VALUES (?,?)',(hashlib.sha256(token.encode()).hexdigest(),info['id']))
        response.set_cookie('presales_source_session',token,httponly=True,samesite='lax',secure=config['frontend_url'].startswith('https://'),max_age=28800,path='/')
        response.delete_cookie('presales_reauth',path='/');response.headers['Cache-Control']='no-store'
        return {'ok':True,'account':account}
