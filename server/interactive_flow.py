"""Version-pinned, account-scoped UI workflow runner. F7 uses shared business adapters."""
import copy,json,math
from uuid import uuid4
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from access_control import check_project,check_owner,role_of,stamp,event
from interaction_schema import InteractionFlow,default_flow
import workflow_studio as flows

_db=None
_readiness=None

def is_change(question):
 return any(w in question for w in ("流程","交互","弹窗","确认卡片")) and any(w in question for w in ("修改","调整","改成","更改","更新","增加","取消","去掉","不要","改为"))

def guard(project,stage,user):
 check_project(user,project)
 if stage!="F7":raise HTTPException(422,"当前交互流程样板适用于 F7")
 if not flows.can_edit_stage(user,stage):raise HTTPException(403,"当前岗位无权使用此交互流程")

def own(c,identifier,project,stage,user):
 row=c.execute("SELECT * FROM interaction_runs WHERE id=? AND project_id=? AND stage=? AND actor=?",(identifier,project,stage,user)).fetchone()
 if not row:raise HTTPException(404,"流程任务不存在")
 return {**dict(row),"value":json.loads(row["value"])}

def task_of(value):
 return next(t for t in value["config"]["definition"]["tasks"] if t["id"]==value["task_id"])

def invalidate_result(value):
 if value.get("turn_id"):
  value.setdefault("superseded_turn_ids",[]).append(value["turn_id"])
 value.update(turn_id=None,trial_id=None,artifact_id=None)
 downstream={n["id"] for n in value["flow"]["nodes"] if n["kind"] in {"calculate","review","export"}}
 value["completed"]=[n for n in value["completed"] if n not in downstream]

def context(project,user):
 data=_readiness(project,user)
 inputs=data["inputs"]
 docs={k:v["document"]["id"] for k,v in inputs.items() if v["document"]}
 with _db() as c:
  fingerprint={k:dict(c.execute("SELECT id,sha256,version FROM documents WHERE id=? AND project_id=?",(v,project)).fetchone()) for k,v in docs.items()}
 need=data["purchase_required"] and (not inputs["purchase"]["document"] or bool(data["missing"]) or not data["matched"] or data["enquiry_stale"])
 return data,fingerprint,need

def node_of(value):
 nodes=value["flow"]["nodes"]
 return nodes[value["index"]] if value["index"]<len(nodes) else None

def advance(value):
 value["index"]+=1
 while node_of(value) and node_of(value)["when"]=="missing_purchase" and not value["need_purchase"]:
  value["skipped"].append(node_of(value)["id"]);value["index"]+=1
 value["status"]="waiting" if node_of(value) else "completed"

def sync_inputs(value,fingerprint,need):
 if value["inputs"]==fingerprint:return False
 value.setdefault("superseded_turn_ids",[]).extend([value["turn_id"]] if value.get("turn_id") else [])
 value.update(index=0,status="waiting",inputs=fingerprint,need_purchase=need,completed=[],skipped=[],turn_id=None,trial_id=None,artifact_id=None,scope_confirmed=False,parameters_confirmed=False)
 value["notice"]="项目输入已更新，原结果不再作为本任务的有效成果；请重新核对输入。"
 return True

def save(c,row,value):
 revision=row["revision"]+1
 c.execute("UPDATE interaction_runs SET value=?,revision=?,updated_at=? WHERE id=?",
           (json.dumps(value,ensure_ascii=False),revision,stamp(),row["id"]))
 return revision

def validate_parameters(task,provided):
 values={p["key"]:p["default"] for p in task["parameters"]}
 values.update({k:v for k,v in provided.items() if k in values})
 for p in task["parameters"]:
  value=values.get(p["key"])
  if p["required"] and (value is None or value==""):raise HTTPException(422,"请填写："+p["label"])
  if p["type"]=="number" and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or p["min"] is not None and value<p["min"] or p["max"] is not None and value>p["max"]):raise HTTPException(422,"参数超出范围："+p["label"])
  if p["type"]=="text" and not isinstance(value,str):raise HTTPException(422,"参数应为文本："+p["label"])
 return values

def execution(project,stage,user,identifier):
 guard(project,stage,user)
 data,fingerprint,need=context(project,user)
 with _db() as c:
  row=own(c,identifier,project,stage,user);value=row["value"]
  if fingerprint!=value["inputs"]:raise HTTPException(409,"项目资料已变更，请返回流程重新核对")
  node=node_of(value)
  if not node or node["kind"]!="calculate":raise HTTPException(409,"请进入生成成本草稿后继续")
  guided=value["flow"].get("navigation","free")=="guided"
  if guided and (not value.get("scope_confirmed") or not value.get("parameters_confirmed")):raise HTTPException(409,"请先完成当前流程的资料和参数确认")
  if value["status"]=="generating":raise HTTPException(409,"该流程正在生成，请等待或停止后重试")
  if guided and value["flow"].get("nodes") and any(n["kind"]=="upload" for n in value["flow"]["nodes"]) and need:raise HTTPException(409,"采购回价尚未匹配，请先补齐回价")
  return copy.deepcopy(value)

def reserve(project,stage,user,identifier,turn):
 with _db() as c:
  c.execute("BEGIN IMMEDIATE");row=own(c,identifier,project,stage,user);v=row["value"]
  if not node_of(v) or node_of(v)["kind"]!="calculate" or v["status"]=="generating":raise HTTPException(409,"当前任务不能重复生成")
  invalidate_result(v)
  v.update(status="generating",turn_id=turn);save(c,row,v)

def generated(c,identifier,project,stage,user,turn,trial_id=None):
 row=own(c,identifier,project,stage,user);v=row["value"]
 if v.get("turn_id")!=turn:raise HTTPException(409,"当前生成任务已改变")
 v["trial_id"]=trial_id;v["completed"].append(node_of(v)["id"]);advance(v);save(c,row,v)

def failed(identifier,project,stage,user,turn):
 with _db() as c:
  row=own(c,identifier,project,stage,user);v=row["value"]
  if v.get("turn_id")==turn and v["status"]=="generating":v["status"]="waiting";save(c,row,v)

def check_adoption(c,project,stage,user,turn):
 rows=c.execute("SELECT value FROM interaction_runs WHERE project_id=? AND stage=? AND actor=?",(project,stage,user)).fetchall()
 for row in rows:
  value=json.loads(row["value"])
  if turn in value.get("superseded_turn_ids",[]):raise HTTPException(409,"此输入版本已失效，请使用重新生成的成果")
  if value.get("turn_id")==turn:
   _,fingerprint,_=context(project,user)
   if value["inputs"]!=fingerprint or (not node_of(value) or node_of(value)["kind"] not in {"review","export"}) and value["status"]!="completed":raise HTTPException(409,"请在当前流程完成审核，输入变化后必须重新核算")

class Start(BaseModel):
 conversation_id:str=Field(min_length=1,max_length=100)
 task_id:str="cost"
 preflight_turn_id:str=Field(min_length=1,max_length=100)
 draft_id:str|None=None
class Navigation(BaseModel):
 expected_revision:int=Field(ge=0)
 node_id:str
 parameters:dict=Field(default_factory=dict)

class Action(BaseModel):
 expected_revision:int=Field(ge=0)
 node_id:str
 confirmed:bool=False
 parameters:dict=Field(default_factory=dict)

def install(app,db,actor,adopt):
 global _db,_readiness
 _db=db
 _readiness=lambda p,u:app.state.f7_cost_readiness(p,u)
 with db() as c:
  c.execute("CREATE TABLE IF NOT EXISTS interaction_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,stage TEXT NOT NULL,actor TEXT NOT NULL,conversation_id TEXT NOT NULL,value TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)")
 router=APIRouter(prefix="/api/projects/{project_id}/workspaces/{stage_id}/interactions")
 def view(row,data):
  v=row["value"]
  preview=""
  if v.get("turn_id"):
   with db() as c:
    reply=c.execute("SELECT content,sources FROM workspace_replies WHERE id=? AND actor=?",(v["turn_id"],row["actor"])).fetchone()
    trial=c.execute("SELECT output FROM flow_trials WHERE id=? AND actor=?",(v.get("trial_id"),row["actor"])).fetchone() if v.get("trial_id") else None
   preview=reply["content"] if reply else trial["output"] if trial else ""
  return {"scope_confirmed":v.get("scope_confirmed",False),"parameters_confirmed":v.get("parameters_confirmed",False),"scenario":next((x.get("scenario") for x in json.loads(reply["sources"]) if x.get("id")=="gsa-f7-cost-demo"),None) if v.get("turn_id") and reply and "sources" in reply.keys() else None,"preview":preview,"id":row["id"],"revision":row["revision"],"conversation_id":row["conversation_id"],"task":task_of(v),"flow":v["flow"],"version":v["config"]["id"],"trial":v["trial"],"draft_id":v.get("draft_id"),"node":node_of(v),"status":v["status"],"parameters":v["parameters"],"completed":v["completed"],"skipped":v["skipped"],"notice":v.get("notice",""),"turn_id":v.get("turn_id"),"artifact_id":v.get("artifact_id"),"readiness":data}
 def read(project,stage,user,identifier):
  guard(project,stage,user);data,fp,need=context(project,user)
  with db() as c:
   c.execute("BEGIN IMMEDIATE");row=own(c,identifier,project,stage,user)
   v=row["value"];v["flow"]=InteractionFlow.model_validate(v["flow"]).model_dump();node=node_of(v)
   expected_upload=node and node["kind"]=="upload" and {k:x for k,x in v["inputs"].items() if k!="purchase"}=={k:x for k,x in fp.items() if k!="purchase"}
   if expected_upload and v["inputs"]!=fp:
    invalidate_result(v);v.update(inputs=fp,need_purchase=need,notice="采购回价已更新，旧草稿已失效；可以重新生成。")
    row["revision"]=save(c,row,v)
   if not expected_upload and sync_inputs(v,fp,need):row["revision"]=save(c,row,v)
   if v["status"]=="generating":
    from datetime import datetime,timezone
    if (datetime.now(timezone.utc)-datetime.fromisoformat(row["updated_at"].replace("Z","+00:00"))).total_seconds()>10:
     execution_row=c.execute("SELECT id,status FROM runtime_runs WHERE project_id=? AND stage_id=? AND actor=? AND turn_id=?",(project,stage,user,v.get("turn_id"))).fetchone()
     try:
      if execution_row:
       import agent_runtime
       with agent_runtime._runtime.locked(execution_row["id"]):pass
      v["status"]="waiting";v["notice"]="上次生成已中断，可重新生成；已确认输入仍保留。";row["revision"]=save(c,row,v)
     except HTTPException:pass
   return view(row,data)

 @router.post("")
 def start(project_id:str,stage_id:str,payload:Start,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  if not payload.draft_id:check_owner(user,project_id,role_of(user))
  data,fp,need=context(project_id,user)
  with db() as c:
   config=flows.resolve(c,project_id,stage_id,user,payload.draft_id)
   task=next((t for t in config["definition"]["tasks"] if t["id"]==payload.task_id),None)
   if not task or not any(s["enabled"] and s["capability"]=="cost" for s in task["steps"]):raise HTTPException(422,"请选择成本估算快捷流程")
   preflight=c.execute("SELECT content,sources FROM workspace_replies WHERE id=? AND project_id=? AND stage_id=? AND actor=?",(payload.preflight_turn_id,project_id,stage_id,user)).fetchone()
   if preflight:
    content=preflight["content"];sources=json.loads(preflight["sources"])
   else:
    trial=c.execute("SELECT output,snapshot FROM flow_trials WHERE id=? AND project_id=? AND stage=? AND actor=? AND status='completed'",(payload.preflight_turn_id,project_id,stage_id,user)).fetchone()
    content=trial["output"] if trial else ""
    sources=json.loads(trial["snapshot"]).get("sources",[]) if trial else []
   marker=next((x for x in sources if x.get("id")=="f7-cost-preflight"),None)
   if not content.strip() or not marker or marker.get("task_id")!=task["id"] or marker.get("conversation_id")!=payload.conversation_id:
    raise HTTPException(409,"请先让大模型分析本次成本估算的当前情况，再点击开始成本估算")
   if marker.get("configuration_digest")!=flows.digest(config["definition"]):
    raise HTTPException(409,"流程已更新，请重新分析当前情况后再开始成本估算")
   flow=InteractionFlow.model_validate(task.get("interaction") or default_flow()).model_dump()
   v={"config":config,"task_id":task["id"],"flow":flow,"index":0,"status":"waiting","inputs":fp,"need_purchase":need,"completed":[],"skipped":[],"parameters":validate_parameters(task,{}),"trial":bool(payload.draft_id),"draft_id":payload.draft_id,"scope_confirmed":False,"parameters_confirmed":False}
   identifier=str(uuid4());c.execute("INSERT INTO interaction_runs VALUES (?,?,?,?,?,?,1,?,?)",(identifier,project_id,stage_id,user,payload.conversation_id,json.dumps(v,ensure_ascii=False),stamp(),stamp()))
   row=own(c,identifier,project_id,stage_id,user)
  return view(row,data)

 @router.get("")
 def latest(project_id:str,stage_id:str,conversation_id:str,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  with db() as c:r=c.execute("SELECT id FROM interaction_runs WHERE project_id=? AND stage=? AND actor=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",(project_id,stage_id,user,conversation_id)).fetchone()
  return read(project_id,stage_id,user,r["id"]) if r else None

 @router.get("/{identifier}")
 def get(project_id:str,stage_id:str,identifier:str,user:str=Depends(actor)):
  return read(project_id,stage_id,user,identifier)


 @router.post("/{identifier}/navigate")
 def navigate(project_id:str,stage_id:str,identifier:str,payload:Navigation,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  data,fp,need=context(project_id,user)
  with db() as c:
   c.execute("BEGIN IMMEDIATE");row=own(c,identifier,project_id,stage_id,user);v=row["value"]
   if row["revision"]!=payload.expected_revision:raise HTTPException(409,"流程状态已更新，请刷新")
   if v["status"]=="generating":raise HTTPException(409,"正在生成，请等待完成或停止后切换")
   sync_inputs(v,fp,need)
   target=next((i for i,n in enumerate(v["flow"]["nodes"]) if n["id"]==payload.node_id),None)
   if target is None:raise HTTPException(422,"步骤不存在")
   if v["flow"].get("navigation","free")=="guided" and target!=v["index"] and payload.node_id not in v["completed"]:
    raise HTTPException(409,"此流程按顺序确认，请先完成当前步骤")
   # Navigation only changes the view. It never confirms inputs or performs review.
   if payload.parameters:
    parameters=validate_parameters(task_of(v),payload.parameters)
    if parameters!=v["parameters"]:
     invalidate_result(v);v["parameters_confirmed"]=False
     v["completed"]=[n for n in v["completed"] if n not in {x["id"] for x in v["flow"]["nodes"] if x["kind"]=="parameters"}]
    v["parameters"]=parameters
   v.update(index=target,status="waiting",notice="")
   save(c,row,v)
  return read(project_id,stage_id,user,identifier)

 @router.post("/{identifier}/skip")
 def skip(project_id:str,stage_id:str,identifier:str,payload:Action,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  _,fp,need=context(project_id,user)
  with db() as c:
   c.execute("BEGIN IMMEDIATE");row=own(c,identifier,project_id,stage_id,user);v=row["value"];node=node_of(v)
   if row["revision"]!=payload.expected_revision or not node or node["id"]!=payload.node_id:raise HTTPException(409,"流程状态已更新，请刷新")
   if v["status"]=="generating":raise HTTPException(409,"正在生成，请稍后切换")
   if v["flow"].get("navigation","free")!="free" or node["kind"] not in {"inspect","parameters","procurement","upload"}:
    raise HTTPException(409,"此步骤需要完成后继续")
   if v["inputs"]!=fp:raise HTTPException(409,"资料版本已改变，请刷新")
   if node["id"] not in v["skipped"]:v["skipped"].append(node["id"])
   v["notice"]="此步骤暂留待补，可随时返回；未确认金额保留待补。"
   advance(v);save(c,row,v)
  return read(project_id,stage_id,user,identifier)

 @router.post("/{identifier}/revise")
 def revise(project_id:str,stage_id:str,identifier:str,payload:Action,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  _,fp,_=context(project_id,user)
  with db() as c:
   c.execute("BEGIN IMMEDIATE");row=own(c,identifier,project_id,stage_id,user);v=row["value"];node=node_of(v)
   if row["revision"]!=payload.expected_revision or not node or node["id"]!=payload.node_id or node["kind"]!="review" or not payload.confirmed:raise HTTPException(409,"请在当前审核步骤退回")
   if v["inputs"]!=fp:raise HTTPException(409,"资料已变更，请重新核对")
   invalidate_result(v)
   v.update(index=next(i for i,n in enumerate(v["flow"]["nodes"]) if n["kind"]=="calculate"),status="waiting",notice="已退回生成步骤，可在对话中补充修改要求后重新生成。")
   save(c,row,v)
  return read(project_id,stage_id,user,identifier)

 @router.post("/{identifier}/advance")
 def act(project_id:str,stage_id:str,identifier:str,payload:Action,user:str=Depends(actor)):
  guard(project_id,stage_id,user)
  if not payload.confirmed:raise HTTPException(422,"请明确确认当前步骤")
  data,fp,need=context(project_id,user)
  with db() as c:
   row=own(c,identifier,project_id,stage_id,user);v=row["value"];node=node_of(v)
   if row["revision"]!=payload.expected_revision or not node or node["id"]!=payload.node_id:raise HTTPException(409,"流程状态已更新，请刷新")
   if node["kind"]!="upload" and v["inputs"]!=fp:raise HTTPException(409,"资料版本已改变，请重新核对")
   kind=node["kind"]
   if kind=="inspect":
    if not data["inputs"]["equipment"]["document"] or not data["bom"]:raise HTTPException(422,"请选择可识别料号、型号和数量的确认版设备 BOM；IO 点表不能替代")
    if any(not r["sku"] for r in data["bom"]):raise HTTPException(422,"配置清单存在缺少料号的设备，请先补齐")
    v["scope_confirmed"]=True
   elif kind=="parameters":
    parameters=validate_parameters(task_of(v),payload.parameters)
    if parameters!=v["parameters"]:invalidate_result(v)
    v["parameters"]=parameters;v["parameters_confirmed"]=True
   elif kind=="procurement":
    if not data["enquiry_id"] or data["enquiry_stale"]:raise HTTPException(422,"请先确认并导出当前设备清单的采购询价单")
   elif kind=="upload":
    if need:raise HTTPException(422,"回价未完整匹配，请核对料号、型号、数量和币种")
    # The expected upload may change only the purchase document.
    previous={k:value for k,value in v["inputs"].items() if k!="purchase"}
    if previous!={k:value for k,value in fp.items() if k!="purchase"}:raise HTTPException(409,"配置或其他成本资料已变化，请重新核对")
    v.update(inputs=fp,need_purchase=False)
   elif kind=="calculate":raise HTTPException(409,"请生成草稿后继续")
   elif kind=="review":
    trial_id=v.get("trial_id")
    if v["trial"]:
     trial=c.execute("SELECT * FROM flow_trials WHERE id=? AND actor=? AND status='completed'",(trial_id,user)).fetchone()
     if not trial:raise HTTPException(409,"试运行尚未完成")
     c.execute("UPDATE flow_trials SET accepted=1,note='已在交互流程中人工审核' WHERE id=?",(trial_id,))
    else:
     reply=c.execute("SELECT * FROM workspace_replies WHERE id=? AND actor=? AND project_id=? AND stage_id=?",(v.get("turn_id"),user,project_id,stage_id)).fetchone()
     if not reply:raise HTTPException(409,"草稿尚未完成")
   elif kind=="export":
    if not v.get("artifact_id") and not v["trial"]:raise HTTPException(409,"请先审核采纳成果")
  if kind=="review" and not v["trial"]:
   artifact=adopt(project_id,stage_id,{"source_id":v["turn_id"],"title":task_of(v)["name"],"content":reply["content"],"conversation_id":row["conversation_id"]},user)
   v["artifact_id"]=artifact["id"]
  with db() as c:
   c.execute("BEGIN IMMEDIATE");current=own(c,identifier,project_id,stage_id,user)
   if current["revision"]!=row["revision"]:raise HTTPException(409,"流程已在另一窗口更新")
   v["notice"]="";v["completed"]=list(dict.fromkeys([*v["completed"],node["id"]]));v["skipped"]=[n for n in v["skipped"] if n!=node["id"]];advance(v);save(c,current,v)
   event(c,user,"interaction_advanced",{"run":identifier,"node":node["id"]})
  return read(project_id,stage_id,user,identifier)
 app.include_router(router)
