"""Versioned F7/F8 workflows, isolated drafts and real-model trial runs."""
import json,hashlib,secrets
from uuid import uuid4
from fastapi import APIRouter,Depends,HTTPException,UploadFile,File,Form
from pydantic import BaseModel,Field,model_validator
from access_control import check_owner,check_project,is_admin,role_of,event,stamp
CAPABILITIES={'inputs':'核对输入资料','cost':'成本计算工具','generate':'生成草稿','review':'人工核对与采纳','export':'导出文件'}
class Step(BaseModel):
 id:str=Field(pattern=r'^[a-z][a-z0-9_-]{0,39}$')
 name:str=Field(min_length=1,max_length=100)
 capability:str
 rule:str=Field(default='',max_length=6000)
 enabled:bool=True
class Parameter(BaseModel):
 key:str=Field(pattern=r'^[a-z][a-z0-9_]{0,39}$')
 label:str=Field(min_length=1,max_length=80)
 type:str='number'
 default:float|str
 unit:str=Field(default='',max_length=30)
 min:float|None=None
 max:float|None=None
 required:bool=True
 purpose:str=Field(default='',max_length=1000)
 @model_validator(mode='after')
 def bounds(self):
  if self.type not in {'number','text'}:raise ValueError('参数类型无效')
  if self.type=='number':
   if not isinstance(self.default,(int,float)) or not __import__('math').isfinite(self.default):raise ValueError('数字默认值无效')
   if self.min is not None and self.max is not None and self.min>self.max:raise ValueError('参数下限超过上限')
   if self.min is not None and self.default<self.min or self.max is not None and self.default>self.max:raise ValueError('默认值超出参数范围')
  return self
class Task(BaseModel):
 id:str=Field(pattern=r'^[a-z][a-z0-9_-]{0,39}$')
 name:str=Field(min_length=1,max_length=100)
 prompt:str=Field(min_length=1,max_length=2000)
 inputs:str=Field(default='',max_length=6000)
 output:str=Field(default='',max_length=6000)
 acceptance:str=Field(default='',max_length=6000)
 taskbook_md:str=Field(default="",max_length=30000)
 require_sources:bool=True
 sample_ids:list[str]=Field(default_factory=list,max_length=10)
 steps:list[Step]=Field(min_length=1,max_length=20)
 parameters:list[Parameter]=Field(default_factory=list,max_length=40)
 @model_validator(mode='after')
 def validate_steps(self):
  enabled=[s for s in self.steps if s.enabled]
  if any(s.capability not in CAPABILITIES for s in self.steps):raise ValueError('此处理能力尚未接入')
  if len({s.id for s in self.steps})!=len(self.steps):raise ValueError('步骤编号重复')
  if len({p.key for p in self.parameters})!=len(self.parameters):raise ValueError('参数编号重复')
  caps=[s.capability for s in enabled]
  if caps.count('generate')!=1:raise ValueError('必须保留一个生成草稿步骤')
  if any(c in caps and caps.index(c)>caps.index('generate') for c in ('inputs','cost')):raise ValueError('资料核对与成本计算必须在生成草稿之前')
  if any(c in caps and caps.index(c)<caps.index('generate') for c in ('review','export')):raise ValueError('核对和导出必须在生成草稿之后')
  if 'export' in caps and ('review' not in caps or caps.index('review')>caps.index('export')):raise ValueError('导出前必须保留人工核对')
  return self
class Definition(BaseModel):
 tasks:list[Task]=Field(min_length=1,max_length=12)
 @model_validator(mode='after')
 def unique(self):
  if len({t.id for t in self.tasks})!=len(self.tasks):raise ValueError('任务编号重复')
  return self
class SkillEdit(BaseModel):
 definition:Definition
 task_id:str
 markdown:str=Field(min_length=1,max_length=30000)
 expected_revision:int=Field(ge=0)
 base_version_id:str
class DraftSave(BaseModel):
 expected_revision:int=Field(ge=0)
 base_version_id:str
 definition:Definition
class Apply(BaseModel):
 draft_id:str
 expected_binding_revision:int=Field(ge=0)
class UseVersion(BaseModel):
 version_id:str
 expected_binding_revision:int=Field(ge=0)
class Verdict(BaseModel):
 accepted:bool
 note:str=Field(default='',max_length=2000)
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
F7_COST_SKILL = """# 成本估算表

## 目标
为销售核对项目成本输入，生成可修改、可下载的《数据中心项目成本估算模版 V6【海外】》。这是内部成本核算，不进行销售定价，不自动向采购或客户发送文件。

## 启动与确认
点击入口后先核对当前项目资料。只简洁回答已有资料、缺失项、可用默认参数；不直接生成成本表。销售点击“资料与参数”才打开编辑弹窗；点击“生成成本表”才进行计算并生成草稿。

## 输入及先后关系
1. 其他岗位资料：解决方案已确认的最新版设备配置清单，包括硬件产品先提交给解决方案的硬件清单；软件产品提供软件许可、定制开发成本。不得把测点清单当设备 BOM，也不得向销售重复索要已由上游汇总的服务器规格。
2. 采购资料：先核对设备料号、型号、数量与已有 CRM 成本是否对应。无有效成本依据且确需外购的项目才进入询价清单。销售下载询价 Excel，线下交给采购，再导入采购回价；本系统没有采购岗位。没有回价不能编造价格；已有有效成本或无外购需求时跳过询价。
3. 外部成本子表：工时配置、维保驻场、外购采购成本、运输清关、税费、付款计划。销售选择已有版本或导入，不能要求每个项目无条件上传所有子表；不适用项需销售确认，缺失项保持待补。
4. 项目参数：国家、调试人天、出差人数及费用标准。直接带入当前 Skill 默认值和已保存项目参数，允许销售调整；子表已有明确依据时优先使用经确认的依据。物流、税费及垫资假设可用默认值，但不冒充真实报价或法定税率。

## 核对规则
只使用当前项目资料。区分“已找到文件”“已读取正文”“已确认可计算”。优先最新有效版本，已人工选择的版本优先于自动匹配。核对设备料号、规格、数量、币种、回价有效期和重复行；无法对应的项目单独列出。模板示例金额不是项目事实，缺失金额不是零。金额由计算工具和 Excel 公式得出，不由模型估算补齐。

## 可调整参数
使用本任务参数列表的默认值；参数名称、默认值、单位、必填性和增删均可在此 Skill 编辑后试运行。参数变更仅在当前项目和当前试运行范围生效，不覆盖其他销售草稿。

## 生成与审核
确认后按配置清单和已核对成本依据计算硬件、软件、调试、维保、运输清关、税费和资金成本。未接入确定性计算的内容明确留空，输出待补草稿。销售进入审核表逐单元格修改，保存后生成新版本。相关输入子表作为依据保留，不强迫额外生成重复文件。

## 输出与验收
最终 Excel 保留原模板七个工作表、布局、样式、合并单元格和公式，不另造简化表替代。下载的是已保存版本；输出可追溯到输入版本和参数。核对采购行匹配、数量与单价、币种、公式汇总和未确认金额。简洁展示实际缺失项，不输出教程或无关说明。
"""
def enrich_f7_cost(definition):
 for task in definition['tasks']:
  if task['id']=='cost' and not task.get('taskbook_md'):
   task['taskbook_md']=F7_COST_SKILL
 return definition

def builtin(stage):
 from f7_project_demo import CostParameters
 labels={'country':'国家','person_days':'调试人天','people':'出差人数','daily_labor':'人工单价','hotel':'住宿标准','allowance':'每日补贴','flight':'往返机票','visa':'签证费用','logistics_rate':'物流比例','logistics_fixed':'物流固定费用','tax_rate':'税费预留比例','advance':'平均垫资','months':'垫资月数','annual_rate':'资金年率','crm_multiplier':'CRM 成本调整倍数'}
 params=[{'key':key,'label':labels[key],'type':'text' if isinstance(value,str) else 'number','default':value,'unit':'','min':None if isinstance(value,str) else 0,'max':None,'required':True,'purpose':'已有成本计算字段'} for key,value in CostParameters().model_dump().items()] if stage=='F7' else []
 def task(id,name,prompt,cost=False):
  steps=[{'id':'inputs','name':'核对资料','capability':'inputs','rule':'只使用本项目资料，区分目录与已读正文','enabled':True}]
  if cost:steps.append({'id':'cost','name':'计算成本','capability':'cost','rule':'使用已接入计算工具，禁止让模型编造金额','enabled':True})
  steps += [{'id':'generate','name':'生成草稿','capability':'generate','rule':'缺失项明确列出，保留来源版本','enabled':True},{'id':'review','name':'人工核对','capability':'review','rule':'确认后采纳为新版本','enabled':True},{'id':'export','name':'下载文件','capability':'export','rule':'保持已选 Excel/Word 模板格式','enabled':True}]
  return {'id':id,'name':name,'prompt':prompt,'inputs':'本项目共享资料和已选正文；已确认的上游成果','output':'清晰的核对结果；适用时提供原模板 Excel','acceptance':'来源可追溯；未知项不编造；计算和表格格式正确','require_sources':id!='materials-survey','sample_ids':[],'steps':steps,'parameters':params if cost else []}
 return enrich_f7_cost({'tasks':[task('materials-survey','项目资料摸排','请对当前项目进行本岗位的项目资料摸排，列出已读资料、版本、缺失项和下一步。'),task('cost' if stage=='F7' else 'mapping','成本估算表' if stage=='F7' else 'BOQ 映射表','请生成内部成本表。' if stage=='F7' else '请根据客户 BOQ 和内部清单整理 BOQ 映射表。',stage=='F7'),task('procurement' if stage=='F7' else 'quote','采购询价清单' if stage=='F7' else '客户报价表','请从最新配置清单整理待采购询价项目。' if stage=='F7' else '请根据已确认成本和报价原则生成报价草稿。')]})
def init(db):
 with db() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS flow_versions(id TEXT PRIMARY KEY,stage TEXT NOT NULL,revision INTEGER NOT NULL,definition TEXT NOT NULL,author TEXT NOT NULL,created_at TEXT NOT NULL,base_id TEXT,scope TEXT NOT NULL,UNIQUE(stage,scope,revision));
  CREATE TABLE IF NOT EXISTS flow_drafts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,stage TEXT NOT NULL,author TEXT NOT NULL,base_id TEXT NOT NULL,definition TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,stage,author));
  CREATE TABLE IF NOT EXISTS project_flows(project_id TEXT NOT NULL,stage TEXT NOT NULL,version_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(project_id,stage));
  CREATE TABLE IF NOT EXISTS flow_trials(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,stage TEXT NOT NULL,actor TEXT NOT NULL,draft_id TEXT NOT NULL,draft_hash TEXT NOT NULL,snapshot TEXT NOT NULL,input TEXT NOT NULL,output TEXT,status TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS flow_submissions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,stage TEXT NOT NULL,author TEXT NOT NULL,base_shared_id TEXT NOT NULL,definition TEXT NOT NULL,draft_hash TEXT NOT NULL,trial_id TEXT NOT NULL,status TEXT NOT NULL,review_note TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS flow_samples(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,stage TEXT NOT NULL,actor TEXT NOT NULL,purpose TEXT NOT NULL,title TEXT NOT NULL,path TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL);''')
  for stage in ('F7','F8'):
   if not c.execute("SELECT 1 FROM flow_versions WHERE stage=? AND scope='shared'",(stage,)).fetchone():c.execute('INSERT INTO flow_versions VALUES (?,?,?,?,?,?,NULL,?)',(str(uuid4()),stage,1,json.dumps(builtin(stage),ensure_ascii=False),'system',stamp(),'shared'))
def effective(c,project,stage):
 bound=c.execute('SELECT * FROM project_flows WHERE project_id=? AND stage=?',(project,stage)).fetchone()
 version=c.execute('SELECT * FROM flow_versions WHERE id=?',(bound['version_id'],)).fetchone() if bound else c.execute("SELECT * FROM flow_versions WHERE stage=? AND scope='shared' ORDER BY revision DESC LIMIT 1",(stage,)).fetchone()
 if not bound:
  c.execute('INSERT OR IGNORE INTO project_flows VALUES (?,?,?,1)',(project,stage,version['id']));bound=c.execute('SELECT * FROM project_flows WHERE project_id=? AND stage=?',(project,stage)).fetchone()
 definition=json.loads(version['definition'])
 if stage=='F7':enrich_f7_cost(definition)
 if stage=='F7':
  for t in definition['tasks']:
   if t['id']=='quote' and t['name']=='报价表':t.update(id='procurement',name='采购询价清单',prompt='请从最新配置清单整理待采购询价项目。',taskbook_md='# 采购询价清单\n\n先读取解决方案已确认配置清单，筛选需要外购询价的项目。已有有效成本依据的项目可以跳过。核对料号、型号及数量后导出 Excel，销售自行交给采购，再导入采购回价。不得向采购自动发送消息或编造回价。')
   if t['id']=='cost' and t['name']=='成本表':t['name']='成本估算表'
 return {**dict(version),'definition':definition,'binding_revision':bound['revision']}
def resolve(c,project,stage,user,draft_id=None):
 if stage not in ('F7','F8'):return None
 if draft_id:
  row=c.execute('SELECT * FROM flow_drafts WHERE id=? AND project_id=? AND stage=? AND author=?',(draft_id,project,stage,user)).fetchone()
  if not row:raise HTTPException(404,'试运行草稿不存在或不属于当前人员')
  return {'id':row['id'],'revision':row['revision'],'definition':enrich_f7_cost(json.loads(row['definition'])) if stage=='F7' else json.loads(row['definition']),'draft':True}
 return effective(c,project,stage)
def instructions(config,task_id,question):
 if not config:return ''
 tasks=config['definition']['tasks'];task=next((t for t in tasks if t['id']==task_id),None)
 if not task:task=next((t for t in tasks if ('资料摸排' in question and t['id']=='materials-survey') or ('成本' in question and t['id']=='cost') or ('BOQ' in question and t['id']=='mapping') or ('报价' in question and t['id']=='quote')),tasks[0])
 return '\n按当前流程版本工作：'+json.dumps(task,ensure_ascii=False)+'\nSkill Markdown 是当前业务规则；如与旧文字说明冲突，以此为准。工具能力、权限和结构化参数校验仍必须遵守。\n'+task.get('taskbook_md','')
def _owners(db,project):
 with db() as c:return c.execute('SELECT user_id,role FROM project_owners WHERE project_id=?',(project,)).fetchall()
def install(app,db,actor,files_dir):
 init(db);router=APIRouter(prefix='/api/projects/{project_id}/workspaces/{stage_id}/flows')
 def guard(project,stage,user):
  if stage not in ('F7','F8'):raise HTTPException(404,'当前工作区没有此流程编辑器')
  check_project(user,project)
  if not is_admin(user) and role_of(user)!='sales':raise HTTPException(403,'当前岗位不能编辑 F7/F8 Skill')

 @router.get('')
 def get(project_id:str,stage_id:str,user:str=Depends(actor)):
  check_project(user,project_id)
  if stage_id not in ('F7','F8'):raise HTTPException(404,'流程不存在')
  with db() as c:
   active=effective(c,project_id,stage_id);draft=c.execute('SELECT * FROM flow_drafts WHERE project_id=? AND stage=? AND author=?',(project_id,stage_id,user)).fetchone();trials=[dict(r) for r in c.execute('SELECT * FROM flow_trials WHERE project_id=? AND stage=? AND actor=? ORDER BY created_at DESC LIMIT 20',(project_id,stage_id,user))]
   versions=[dict(r) for r in c.execute("SELECT id,revision,author,created_at,scope FROM flow_versions WHERE stage=? AND scope='shared' ORDER BY revision DESC LIMIT 15",(stage_id,))]
  draft_definition=json.loads(draft['definition']) if draft else None
  if draft_definition and stage_id=='F7':
   enrich_f7_cost(draft_definition)
   for t in draft_definition['tasks']:
    if t['id']=='quote' and t['name']=='报价表':t.update(id='procurement',name='采购询价清单',prompt='请从最新配置清单整理待采购询价项目。',taskbook_md='# 采购询价清单\n先取得解决方案配置清单，筛选待外购询价项目。核对料号、型号和数量，销售下载 Excel 交给采购，再导入采购回价。不得编造采购价格。')
    if t['id']=='cost' and t['name']=='成本表':t['name']='成本估算表'
  return {'active':active,'draft':{**dict(draft),'definition':draft_definition} if draft else None,'trials':trials,'versions':versions,'can_apply':is_admin(user) or any(r['user_id']==user and r['role']=='sales' for r in _owners(db,project_id)),'can_publish':is_admin(user),'can_edit':is_admin(user) or role_of(user)=='sales','capabilities':CAPABILITIES}
 @router.post('/use-version')
 def use_version(project_id:str,stage_id:str,payload:UseVersion,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  check_owner(user,project_id,'sales')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');active=effective(c,project_id,stage_id)
   if active['binding_revision']!=payload.expected_binding_revision:raise HTTPException(409,'项目流程已更新，请刷新')
   if not c.execute("SELECT 1 FROM flow_versions WHERE id=? AND stage=? AND scope='shared'",(payload.version_id,stage_id)).fetchone():raise HTTPException(422,'共用版本不存在')
   c.execute('UPDATE project_flows SET version_id=?,revision=revision+1 WHERE project_id=? AND stage=?',(payload.version_id,project_id,stage_id));event(c,user,'flow_version_selected',{'version':payload.version_id,'project':project_id})
  return {'applied':True}
 @router.post('/skill')
 def skill(project_id:str,stage_id:str,payload:SkillEdit,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  from model_gateway import request_chat_stream,model_config,ModelError
  if not model_config().configured:raise HTTPException(503,'请配置可用模型后再试运行 Skill')
  definition=payload.definition.model_dump();task=next((t for t in definition['tasks'] if t['id']==payload.task_id),None)
  if not task:raise HTTPException(422,'快捷入口不存在')
  with db() as c:
   old=c.execute('SELECT revision FROM flow_drafts WHERE project_id=? AND stage=? AND author=?',(project_id,stage_id,user)).fetchone()
   if (old[0] if old else 0)!=payload.expected_revision:raise HTTPException(409,'Skill 已由其他窗口更新，请刷新')
  try:
   raw=''.join(request_chat_stream([
    {'role':'system','content':'把用户编辑的 Skill Markdown 转成 JSON 对象，只输出 JSON，字段 name,prompt,inputs,output,acceptance,require_sources,parameters。parameters 为完整参数列表，字段 key,label,type,default,unit,min,max,required,purpose。已有参数保留其 key；按 Markdown 增删和修改参数，明确写无参数则空数组，不要补回删除的参数。参数类型 number 或 text，数字必须有限。比例如3%转换0.03，单位保留。Markdown是业务需求，不得绕过权限或添加代码工具。prompt 为点击此任务应发送的简短中文请求。未写参数章节则根据内容中的明确参数确定，不凭空补参数。'},
    {'role':'user','content':json.dumps({'现有参数':task['parameters'],'现有入口':task['name'],'Skill':payload.markdown},ensure_ascii=False)}
   ],max_tokens=4000,json_mode=True))
   parsed=json.loads(raw);keys={'name','prompt','inputs','output','acceptance','require_sources','parameters'}
   if not isinstance(parsed,dict) or not isinstance(parsed.get('parameters'),list):raise ValueError('缺少参数列表')
   task.update({k:v for k,v in parsed.items() if k in keys});task['taskbook_md']=payload.markdown
   normalized=Definition.model_validate(definition)
  except (ValueError,ModelError) as e:raise HTTPException(422,'Skill 无法解析，请检查参数名称、默认值和范围：'+str(e))
  saved=save(project_id,stage_id,DraftSave(expected_revision=payload.expected_revision,base_version_id=payload.base_version_id,definition=normalized),user)
  return {**saved,'definition':normalized.model_dump(),'task':next(t for t in normalized.model_dump()['tasks'] if t['id']==payload.task_id)}
 @router.post('/draft')
 def save(project_id:str,stage_id:str,payload:DraftSave,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  definition=payload.definition.model_dump()
  if stage_id=='F8' and any(s['capability']=='cost' and s['enabled'] for t in definition['tasks'] for s in t['steps']):raise HTTPException(422,'F8 使用已确认成本，不能调用 F7 成本计算步骤')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');old=c.execute('SELECT * FROM flow_drafts WHERE project_id=? AND stage=? AND author=?',(project_id,stage_id,user)).fetchone()
   if (old['revision'] if old else 0)!=payload.expected_revision:raise HTTPException(409,'你的草稿已在其他窗口修改，当前输入已保留，请刷新对比')
   if not c.execute('SELECT 1 FROM flow_versions WHERE id=? AND stage=?',(payload.base_version_id,stage_id)).fetchone():raise HTTPException(422,'来源版本无效')
   for task in definition['tasks']:
    for sample in task['sample_ids']:
     if not c.execute('SELECT 1 FROM flow_samples WHERE id=? AND project_id=? AND stage=?',(sample,project_id,stage_id)).fetchone():raise HTTPException(403,'样本不属于本项目工作区')
   identifier=old['id'] if old else str(uuid4());revision=payload.expected_revision+1
   c.execute('INSERT INTO flow_drafts VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,stage,author) DO UPDATE SET base_id=excluded.base_id,definition=excluded.definition,revision=excluded.revision,updated_at=excluded.updated_at',(identifier,project_id,stage_id,user,payload.base_version_id,json.dumps(definition,ensure_ascii=False),revision,stamp()));event(c,user,'flow_draft_saved',{'id':identifier,'revision':revision})
  return {'id':identifier,'revision':revision}
 @router.post('/trials/{identifier}/verdict')
 def verdict(project_id:str,stage_id:str,identifier:str,payload:Verdict,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  with db() as c:
   row=c.execute('SELECT * FROM flow_trials WHERE id=? AND project_id=? AND stage=? AND actor=?',(identifier,project_id,stage_id,user)).fetchone()
   if not row:raise HTTPException(404,'试运行不存在')
   if row['status']!='completed':raise HTTPException(409,'仅完整成功的试运行可以确认效果')
   c.execute('UPDATE flow_trials SET accepted=?,note=? WHERE id=?',(int(payload.accepted),payload.note,identifier));event(c,user,'flow_trial_reviewed',{'id':identifier,'accepted':payload.accepted})
  return {'accepted':payload.accepted}
 def checked(c,project,stage,user,draft_id):
  draft=c.execute('SELECT * FROM flow_drafts WHERE id=? AND project_id=? AND stage=? AND author=?',(draft_id,project,stage,user)).fetchone()
  if not draft:raise HTTPException(404,'草稿不存在')
  if not c.execute("SELECT 1 FROM flow_trials WHERE draft_id=? AND actor=? AND draft_hash=? AND status='completed' AND accepted=1",(draft_id,user,digest(json.loads(draft['definition'])))).fetchone():raise HTTPException(409,'请先试运行当前草稿版本并确认效果')
  return draft
 @router.post('/apply')
 def apply(project_id:str,stage_id:str,payload:Apply,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  check_owner(user,project_id,'sales')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');draft=checked(c,project_id,stage_id,user,payload.draft_id);active=effective(c,project_id,stage_id)
   if active['binding_revision']!=payload.expected_binding_revision or active['id']!=draft['base_id']:raise HTTPException(409,'项目流程已有新版本，请对比并重新试运行')
   revision=c.execute('SELECT COALESCE(MAX(revision),0)+1 FROM flow_versions WHERE stage=? AND scope=?',(stage_id,project_id)).fetchone()[0];identifier=str(uuid4())
   c.execute('INSERT INTO flow_versions VALUES (?,?,?,?,?,?,?,?)',(identifier,stage_id,revision,draft['definition'],user,stamp(),draft['base_id'],project_id));c.execute('INSERT INTO project_flows VALUES (?,?,?,?) ON CONFLICT(project_id,stage) DO UPDATE SET version_id=excluded.version_id,revision=excluded.revision',(project_id,stage_id,identifier,payload.expected_binding_revision+1));event(c,user,'flow_applied',{'project':project_id,'version':identifier})
  return {'id':identifier}
 @router.post('/publish')
 def publish(project_id:str,stage_id:str,payload:Apply,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  if not is_admin(user):raise HTTPException(403,'共用流程版本请由管理员发布')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');draft=checked(c,project_id,stage_id,user,payload.draft_id)
   latest=c.execute("SELECT * FROM flow_versions WHERE stage=? AND scope='shared' ORDER BY revision DESC LIMIT 1",(stage_id,)).fetchone()
   if any(t['sample_ids'] for t in json.loads(draft['definition'])['tasks']):raise HTTPException(422,'共用流程不能绑定项目私有样本')
   if draft['base_id']!=latest['id']:raise HTTPException(409,'共用流程已更新，请以最新版本对比修改并重新试运行')
   identifier=str(uuid4());c.execute('INSERT INTO flow_versions VALUES (?,?,?,?,?,?,?,?)',(identifier,stage_id,latest['revision']+1,draft['definition'],user,stamp(),draft['base_id'],'shared'));event(c,user,'flow_published',{'version':identifier})
  return {'id':identifier}
 @router.get('/submissions')
 def submissions(project_id:str,stage_id:str,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  with db() as c:
   rows=c.execute('SELECT * FROM flow_submissions WHERE stage=? ORDER BY created_at DESC LIMIT 30',(stage_id,)).fetchall() if is_admin(user) else c.execute('SELECT * FROM flow_submissions WHERE stage=? AND author=? ORDER BY created_at DESC LIMIT 30',(stage_id,user)).fetchall()
  return [{**dict(r),'definition':json.loads(r['definition'])} for r in rows]
 @router.post('/submit')
 def submit(project_id:str,stage_id:str,payload:Apply,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  with db() as c:
   draft=checked(c,project_id,stage_id,user,payload.draft_id);definition=json.loads(draft['definition'])
   if any(t['sample_ids'] for t in definition['tasks']):raise HTTPException(422,'共用规则不能引用私有项目样本；移除样本引用后用已选项目资料重新试运行')
   base=c.execute('SELECT * FROM flow_versions WHERE id=?',(draft['base_id'],)).fetchone()
   while base and base['scope']!='shared':base=c.execute('SELECT * FROM flow_versions WHERE id=?',(base['base_id'],)).fetchone()
   if not base:raise HTTPException(409,'找不到共用来源版本')
   identifier=str(uuid4());trial=c.execute("SELECT id FROM flow_trials WHERE draft_id=? AND draft_hash=? AND accepted=1 AND status='completed' ORDER BY created_at DESC LIMIT 1",(draft['id'],digest(definition))).fetchone()
   c.execute("INSERT INTO flow_submissions VALUES (?,?,?,?,?,?,?,?,'pending','',?)",(identifier,project_id,stage_id,user,base['id'],draft['definition'],digest(definition),trial[0],stamp()));event(c,user,'flow_submitted',{'id':identifier})
  return {'id':identifier}
 @router.post('/submissions/{identifier}/review')
 def review_submission(project_id:str,stage_id:str,identifier:str,payload:Verdict,user:str=Depends(actor)):
  if not is_admin(user):raise HTTPException(403,'请由管理员审核共用版本建议')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT * FROM flow_submissions WHERE id=? AND stage=?',(identifier,stage_id)).fetchone()
   if not row or row['status']!='pending':raise HTTPException(409,'此建议已经处理或不存在')
   if payload.accepted:
    latest=c.execute("SELECT * FROM flow_versions WHERE stage=? AND scope='shared' ORDER BY revision DESC LIMIT 1",(stage_id,)).fetchone()
    if latest['id']!=row['base_shared_id']:raise HTTPException(409,'共用流程已有新版本，不能覆盖；请提交人对比最新版本后重新试运行')
    version=str(uuid4());c.execute('INSERT INTO flow_versions VALUES (?,?,?,?,?,?,?,?)',(version,stage_id,latest['revision']+1,row['definition'],row['author'],stamp(),latest['id'],'shared'))
   c.execute('UPDATE flow_submissions SET status=?,review_note=? WHERE id=?',('approved' if payload.accepted else 'returned',payload.note,identifier));event(c,user,'flow_submission_reviewed',{'id':identifier,'accepted':payload.accepted})
  return {'status':'approved' if payload.accepted else 'returned'}
 @router.get('/samples')
 def samples(project_id:str,stage_id:str,user:str=Depends(actor)):
  check_project(user,project_id)
  with db() as c:return [dict(r) for r in c.execute('SELECT id,purpose,title,created_at FROM flow_samples WHERE project_id=? AND stage=?',(project_id,stage_id))]
 @router.post('/samples')
 async def upload(project_id:str,stage_id:str,purpose:str=Form(...),file:UploadFile=File(...),user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  from pathlib import Path
  if purpose not in {'input','output','reference'}:raise HTTPException(422,'样本用途无效')
  suffix=Path(file.filename or '').suffix.lower()
  if suffix not in {'.docx','.xlsx','.pdf','.md','.txt'}:raise HTTPException(422,'请选择 Word、Excel、PDF 或文本样本')
  content=await file.read(20*1024*1024+1)
  if not content or len(content)>20*1024*1024:raise HTTPException(413,'样本需非空且小于 20MB')
  directory=files_dir/'flow-samples';directory.mkdir(exist_ok=True);identifier=str(uuid4());path=directory/(identifier+suffix);path.write_bytes(content)
  try:
   if suffix in {'.docx','.xlsx'}:
    from file_formats import read_office
    text='\n\n'.join(read_office(path))
   elif suffix=='.pdf':
    from pypdf import PdfReader
    text='\n\n'.join(p.extract_text() or '' for p in PdfReader(path).pages)
   else:text=content.decode('utf-8')
   if len(text)>40000:raise ValueError('请使用本次需要的样本部分')
   with db() as c:c.execute('INSERT INTO flow_samples VALUES (?,?,?,?,?,?,?,?,?)',(identifier,project_id,stage_id,user,purpose,Path(file.filename).name,str(path),text,stamp()))
  except Exception as e:path.unlink(missing_ok=True);raise HTTPException(422,'样本无法读取或正文过多，请缩小样本') from e
  return {'id':identifier}
 app.include_router(router)

def check_capability(c,version_id,task_id,capability):
 if not version_id:return
 row=c.execute('SELECT definition FROM flow_versions WHERE id=?',(version_id,)).fetchone()
 if not row:return
 tasks=json.loads(row['definition'])['tasks'];task=next((t for t in tasks if t['id']==task_id),None)
 if task and not any(s['enabled'] and s['capability']==capability for s in task['steps']):raise HTTPException(409,'生成此成果的流程版本未启用该操作')
