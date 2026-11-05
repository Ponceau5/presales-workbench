"""Executable UI configuration, durable waiting, isolated actors and invalidation."""
import os,tempfile,json,copy,unittest,hashlib
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv("PRESALES_TEST_TMP"));os.environ["PRESALES_DATA_DIR"]=root.name
from fastapi.testclient import TestClient
from app import app,db,now,pages
from openpyxl import Workbook
from model_gateway import ModelConfig
from interaction_schema import InteractionFlow,default_flow

class InteractiveFlowTests(unittest.TestCase):
 def setUp(self):
  self.c=TestClient(app);self.h={"Authorization":"Bearer "+self.c.post("/api/session",json={"username":"pm","password":"demo2026"}).json()["token"]}
  self.p="FLOW-"+uuid4().hex[:8];self.stage="/api/projects/"+self.p+"/workspaces/F7";self.base=self.stage+"/interactions";self.conversation=uuid4().hex
  self.assertEqual(self.c.post("/api/access/projects",headers=self.h,json={"id":self.p,"name":self.p}).status_code,200)
  self.equipment=self.document("设备BOM",False)
  self.purchase=self.document("待选成本附件",True)
  self.bind("equipment",self.equipment)
 def document(self,title,purchase,bad=False):
  identifier=uuid4().hex;path=Path(root.name)/(identifier+".xlsx")
  w=Workbook();s=w.active
  s.append(["料号","设备名称","型号","数量","采购类型","采购单价","币种"])
  s.append(["A-1","控制器","M-wrong" if bad else "M1",2,"外购",50 if purchase else None,"CNY"])
  w.save(path)
  with db() as c:c.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)",(identifier,self.p,title,"V1",path.name,str(path),hashlib.sha256(path.read_bytes()).hexdigest(),"pm",now()))
  with db() as c:c.executemany("INSERT INTO document_pages VALUES (?,?,?)",[(identifier,i+1,text) for i,text in enumerate(pages(path))])
  return identifier
 def bind(self,slot,identifier):
  r=self.c.post(self.stage+"/cost-flow/input",headers=self.h,json={"slot":slot,"document_id":identifier})
  self.assertEqual(r.status_code,200,r.text)
 def preflight(self,draft=None):
  turn=uuid4().hex
  with patch("workspace_router.model_config",return_value=ModelConfig("zhipu","fixture","mock","fixture")),patch("workspace_router.request_agent_stream",return_value=iter(["当前已登记配置清单，采购回价、软件成本和部分条件尚待确认。可点击下方开始成本估算。"])) as model:
   response=self.c.post(self.stage+"/ask-stream",headers=self.h,json={"question":"请分析当前成本估算情况","turn_id":turn,"conversation_id":self.conversation,"task_id":"cost","cost_preflight":True,"test_run":bool(draft),"flow_draft_id":draft})
  self.assertEqual(response.status_code,200,response.text);self.assertIn('"type": "done"',response.text)
  self.assertTrue(model.call_args.kwargs["read_only"])
  events=[json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
  workflow=next(e["data"] for e in events if e["type"]=="workflow")
  self.assertFalse(workflow["review"]);self.assertFalse(workflow["export"])
  return next((e["id"] for e in events if e["type"]=="trial"),turn)
 def start(self,draft=None):
  preflight=self.preflight(draft)
  r=self.c.post(self.base,headers=self.h,json={"conversation_id":self.conversation,"task_id":"cost","draft_id":draft,"preflight_turn_id":preflight})
  self.assertEqual(r.status_code,200,r.text);return r.json()
 def current(self,run):
  r=self.c.get(self.base+"/"+run["id"],headers=self.h);self.assertEqual(r.status_code,200,r.text);return r.json()
 def step(self,run,**extra):
  r=self.c.post(self.base+"/"+run["id"]+"/advance",headers=self.h,json={"expected_revision":run["revision"],"node_id":run["node"]["id"],"confirmed":True,**extra})
  self.assertEqual(r.status_code,200,r.text);return r.json()
 def enquiry(self,run):
  r=self.c.post(self.stage+"/cost-flow/enquiry",headers=self.h,json={"rows":run["readiness"]["bom"],"expected_revision":run["readiness"]["enquiry_revision"]})
  self.assertEqual(r.status_code,200,r.text);return self.current(run)
 def generate(self,run):
  with patch("workspace_router.model_config",return_value=ModelConfig("zhipu","fixture","mock","fixture")),patch("workspace_router.request_agent_stream",return_value=iter(["成本依据已核对，缺失软件和外部成本保持待补。"])):
   r=self.c.post(self.stage+"/ask-stream",headers=self.h,json={"question":"请生成成本估算表","task_id":"cost","turn_id":uuid4().hex,"interaction_run_id":run["id"]})
  self.assertEqual(r.status_code,200,r.text);self.assertIn('"type": "done"',r.text)
  return self.current(run)
 def calculation(self):
  self.bind("purchase",self.purchase)
  r=self.step(self.start());self.assertEqual(r["node"]["kind"],"parameters")
  return self.step(r)
 def test_missing_return_wait_resume_match_and_full_generation(self):
  r=self.step(self.start());self.assertEqual(r["node"]["kind"],"procurement")
  r=self.step(self.enquiry(r));self.assertEqual(r["node"]["kind"],"upload")
  resumed=self.c.get(self.base,headers=self.h,params={"conversation_id":self.conversation}).json()
  self.assertEqual(resumed["id"],r["id"]);self.assertEqual(resumed["node"]["kind"],"upload")
  bad=self.document("错误采购回价",True,True);self.bind("purchase",bad)
  # Expected purchase upload must not restart the whole flow.
  r=self.current(r);self.assertEqual(r["node"]["kind"],"upload")
  self.assertEqual(self.c.post(self.base+"/"+r["id"]+"/advance",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"],"confirmed":True}).status_code,422)
  self.bind("purchase",self.purchase);r=self.step(self.current(r));self.assertEqual(r["node"]["kind"],"parameters")
  r=self.step(r);self.assertEqual(r["node"]["kind"],"calculate")
  r=self.generate(r);self.assertEqual(r["node"]["kind"],"review");self.assertIn("成本",r["preview"])
  r=self.step(r);self.assertEqual(r["node"]["kind"],"export");self.assertTrue(r["artifact_id"])
  r=self.step(r);self.assertEqual(r["status"],"completed")
 def test_generation_before_confirmation_is_rejected(self):
  r=self.start()
  response=self.c.post(self.stage+"/ask-stream",headers=self.h,json={"question":"生成成本","turn_id":uuid4().hex,"interaction_run_id":r["id"]})
  self.assertEqual(response.status_code,409)
 def test_input_change_invalidates_result_and_blocks_direct_adoption(self):
  r=self.generate(self.calculation());old=r["turn_id"]
  self.bind("equipment",self.document("设备BOM V2",False))
  r=self.current(r);self.assertEqual(r["node"]["kind"],"inspect")
  response=self.c.post(self.stage+"/artifacts/adopt",headers=self.h,json={"source_id":old,"title":"成本估算表","content":r["preview"] or "old","conversation_id":self.conversation})
  self.assertEqual(response.status_code,409)
 def test_changed_input_blocks_using_adopted_cost_as_downstream_input(self):
  r=self.step(self.generate(self.calculation()));artifact=r["artifact_id"]
  self.bind("equipment",self.document("设备BOM V2",False))
  response=self.c.post("/api/projects/"+self.p+"/workspaces/F8/ask-stream",headers=self.h,json={"question":"映射BOQ","task_id":"mapping","turn_id":uuid4().hex,"upstream_ids":[artifact]})
  self.assertEqual(response.status_code,409,response.text)
 def test_revise_returns_to_generation_without_adopting_old_result(self):
  r=self.generate(self.calculation())
  response=self.c.post(self.base+"/"+r["id"]+"/revise",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"],"confirmed":True})
  self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()["node"]["kind"],"calculate")
 def test_changed_order_and_chat_presentation_are_frozen_per_run(self):
  cfg=self.c.get(self.stage+"/flows",headers=self.h).json();definition=copy.deepcopy(cfg["active"]["definition"])
  task=next(t for t in definition["tasks"] if t["id"]=="cost")
  flow=default_flow();params=flow["nodes"].pop(3);params["presentation"]="chat";flow["nodes"].insert(0,params)
  task["interaction"]=flow
  response=self.c.post(self.stage+"/flows/draft",headers=self.h,json={"expected_revision":0,"base_version_id":cfg["active"]["id"],"definition":definition})
  self.assertEqual(response.status_code,200,response.text)
  r=self.start(response.json()["id"]);self.assertEqual(r["node"]["kind"],"parameters");self.assertEqual(r["node"]["presentation"],"chat")
  # Another edit cannot change the running instance.
  task["interaction"]=default_flow()
  response=self.c.post(self.stage+"/flows/draft",headers=self.h,json={"expected_revision":response.json()["revision"],"base_version_id":cfg["active"]["id"],"definition":definition})
  self.assertEqual(response.status_code,200,response.text)
  self.assertEqual(self.current(r)["node"]["presentation"],"chat")
 def test_other_account_cannot_read_run_and_stale_click_is_rejected(self):
  r=self.start();other="other_"+uuid4().hex[:6]
  self.assertEqual(self.c.post("/api/access/users",headers=self.h,json={"username":other,"display_name":other,"role":"admin","password":"fixture2026"}).status_code,200)
  h={"Authorization":"Bearer "+self.c.post("/api/session",json={"username":other,"password":"fixture2026"}).json()["token"]}
  self.assertEqual(self.c.get(self.base+"/"+r["id"],headers=h).status_code,404)
  self.step(r)
  self.assertEqual(self.c.post(self.base+"/"+r["id"]+"/advance",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"],"confirmed":True}).status_code,409)
 def test_model_proposal_modifies_actual_flow_then_trial_can_be_applied(self):
  self.bind("purchase",self.purchase)
  flow=default_flow();params=flow["nodes"].pop(3);params["presentation"]="chat";flow["nodes"].insert(0,params)
  output={"markdown":"# 成本估算表\n"+"先在聊天中确认参数，再核对确认版 BOM 和成本依据，缺少采购回价时输出询价单并等待上传，确认后计算并审核导出。"*3,
          "summary":"参数改为聊天确认并移到第一步","changes":{"interaction":flow}}
  with patch("skill_learning.request_agent_stream",return_value=iter([json.dumps(output)])):
   response=self.c.post(self.stage+"/flows/learn-stream",headers=self.h,json={"question":"修改F7流程，参数先在聊天中确认","source_turn_ids":[],"turn_id":uuid4().hex,"task_id":"cost"})
  self.assertEqual(response.status_code,200,response.text)
  proposal=next(json.loads(line[6:])["data"] for line in response.text.splitlines() if line.startswith("data: ") and json.loads(line[6:])["type"]=="skill_proposal")
  self.assertEqual(proposal["interaction"]["nodes"][0]["presentation"],"chat")
  self.assertIn("系统交互流程",proposal["markdown"])
  result=self.c.post(self.stage+"/flows/learn/"+proposal["id"]+"/confirm",headers=self.h)
  self.assertEqual(result.status_code,200,result.text)
  r=self.start(result.json()["draft_id"]);self.assertEqual(r["node"]["kind"],"parameters")
  r=self.step(r);r=self.step(r);self.assertEqual(r["node"]["kind"],"calculate")
  r=self.generate(r);self.assertTrue(r["trial"])
  r=self.step(r)
  cfg=self.c.get(self.stage+"/flows",headers=self.h).json()
  result=self.c.post(self.stage+"/flows/apply",headers=self.h,json={"draft_id":cfg["draft"]["id"],"expected_binding_revision":cfg["active"]["binding_revision"]})
  self.assertEqual(result.status_code,200,result.text)
  new=self.start();self.assertFalse(new["trial"]);self.assertEqual(new["node"]["kind"],"parameters");self.assertEqual(new["node"]["presentation"],"chat")
 def test_unsafe_flow_is_rejected(self):
  for field in ("review","inspect","parameters"):
   flow=default_flow();flow["nodes"]=[n for n in flow["nodes"] if n["kind"]!=field]
   with self.assertRaises(ValueError):InteractionFlow.model_validate(flow)
  flow=default_flow();flow["nodes"][0]["when"]="some_python_code()"
  with self.assertRaises(ValueError):InteractionFlow.model_validate(flow)

 def navigate(self,run,kind,**extra):
  node=next(n for n in run["flow"]["nodes"] if n["kind"]==kind)
  response=self.c.post(self.base+"/"+run["id"]+"/navigate",headers=self.h,json={"expected_revision":run["revision"],"node_id":node["id"],**extra})
  self.assertEqual(response.status_code,200,response.text);return response.json()
 def test_free_navigation_and_defer_do_not_confirm_or_require_bom(self):
  blank=self.document("只有待补结构",False)
  with db() as c:c.execute("DELETE FROM document_pages WHERE document_id=?",(blank,))
  # The selected file has no recognized BOM; a user can still inspect any step.
  with db() as c:
   r=c.execute("SELECT path FROM documents WHERE id=?",(blank,)).fetchone()
  w=Workbook();w.active.append(["点位","描述"]);w.save(r["path"])
  self.bind("equipment",blank)
  r=self.start()
  skipped=self.c.post(self.base+"/"+r["id"]+"/skip",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"]})
  self.assertEqual(skipped.status_code,200,skipped.text);r=skipped.json()
  self.assertFalse(r["scope_confirmed"]);self.assertTrue(r["skipped"])
  r=self.navigate(r,"review")
  bad=self.c.post(self.base+"/"+r["id"]+"/advance",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"],"confirmed":True})
  self.assertEqual(bad.status_code,409)
  self.assertEqual(self.c.post(self.base+"/"+r["id"]+"/skip",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"]}).status_code,409)
  r=self.navigate(r,"calculate");r=self.generate(r)
  self.assertFalse(r["scope_confirmed"]);self.assertFalse(r["parameters_confirmed"])
  self.assertIn("待补",r["preview"]);self.assertNotIn("小计：0.00",r["preview"]);self.assertEqual(r["node"]["kind"],"review")
  self.assertFalse(r["artifact_id"])
 def test_changed_parameters_invalidate_previous_result_but_navigation_does_not(self):
  r=self.generate(self.calculation());old=r["turn_id"]
  r=self.navigate(r,"parameters");self.assertEqual(r["turn_id"],old)
  parameter=next(p for p in r["task"]["parameters"] if p["type"]=="number")
  values=dict(r["parameters"]);values[parameter["key"]]=parameter["min"] if parameter["min"] is not None and parameter["min"]!=values[parameter["key"]] else values[parameter["key"]]+1
  r=self.navigate(r,"calculate",parameters=values)
  self.assertIsNone(r["turn_id"]);self.assertFalse(r["parameters_confirmed"])
  blocked=self.c.post(self.stage+"/artifacts/adopt",headers=self.h,json={"source_id":old,"title":"成本估算表","content":"old","conversation_id":self.conversation})
  self.assertEqual(blocked.status_code,409,blocked.text)
 def test_guided_flow_can_still_be_selected_by_model_configuration(self):
  cfg=self.c.get(self.stage+"/flows",headers=self.h).json();definition=copy.deepcopy(cfg["active"]["definition"])
  task=next(t for t in definition["tasks"] if t["id"]=="cost");flow=default_flow();flow["navigation"]="guided";task["interaction"]=flow
  draft=self.c.post(self.stage+"/flows/draft",headers=self.h,json={"expected_revision":0,"base_version_id":cfg["active"]["id"],"definition":definition})
  self.assertEqual(draft.status_code,200,draft.text)
  r=self.start(draft.json()["id"]);target=next(n for n in r["flow"]["nodes"] if n["kind"]=="calculate")
  payload={"expected_revision":r["revision"],"node_id":target["id"]}
  self.assertEqual(self.c.post(self.base+"/"+r["id"]+"/navigate",headers=self.h,json=payload).status_code,409)
  self.assertEqual(self.c.post(self.base+"/"+r["id"]+"/skip",headers=self.h,json={**payload,"node_id":r["node"]["id"]}).status_code,409)

 def test_return_update_and_parameter_confirmation_invalidate_old_drafts(self):
  for change in ("purchase","parameters"):
   with self.subTest(change=change):
    r=self.generate(self.calculation());old=r["turn_id"]
    r=self.navigate(r,"upload" if change=="purchase" else "parameters")
    if change=="purchase":
     self.bind("purchase",self.document("采购回价 V2",True))
     r=self.current(r);self.assertEqual(r["node"]["kind"],"upload")
     self.assertIsNone(r["turn_id"]);r=self.step(r)
    else:
     p=next(p for p in r["task"]["parameters"] if p["type"]=="number")
     values={**r["parameters"],p["key"]:p["min"] if p["min"] is not None and p["min"]!=r["parameters"][p["key"]] else r["parameters"][p["key"]]+1}
     r=self.step(r,parameters=values);self.assertIsNone(r["turn_id"])
    r=self.navigate(r,"review")
    blocked=self.c.post(self.stage+"/artifacts/adopt",headers=self.h,json={"source_id":old,"title":"成本估算表","content":"old","conversation_id":self.conversation})
    self.assertEqual(blocked.status_code,409,blocked.text)
 def test_revising_does_not_mark_deferred_inputs_completed(self):
  r=self.start();source=r["node"]["id"]
  r=self.navigate(r,"calculate");r=self.generate(r)
  response=self.c.post(self.base+"/"+r["id"]+"/revise",headers=self.h,json={"expected_revision":r["revision"],"node_id":r["node"]["id"],"confirmed":True})
  self.assertEqual(response.status_code,200,response.text)
  self.assertNotIn(source,response.json()["completed"]);self.assertFalse(response.json()["scope_confirmed"])

 def test_model_analysis_is_required_before_start_and_bound_to_conversation(self):
  before=self.c.get(self.base,headers=self.h,params={"conversation_id":self.conversation}).json()
  self.assertIsNone(before)
  rejected=self.c.post(self.base,headers=self.h,json={"conversation_id":self.conversation,"task_id":"cost","preflight_turn_id":"not-an-analysis"})
  self.assertEqual(rejected.status_code,409,rejected.text)
  preflight=self.preflight()
  with db() as c:content=c.execute("SELECT content FROM workspace_replies WHERE id=?",(preflight,)).fetchone()["content"]
  adoption=self.c.post(self.stage+"/artifacts/adopt",headers=self.h,json={"source_id":preflight,"title":"成本估算表","content":content,"conversation_id":self.conversation})
  self.assertEqual(adoption.status_code,409,adoption.text)
  self.assertIsNone(self.c.get(self.base,headers=self.h,params={"conversation_id":self.conversation}).json())
  rejected=self.c.post(self.base,headers=self.h,json={"conversation_id":"another-conversation","task_id":"cost","preflight_turn_id":preflight})
  self.assertEqual(rejected.status_code,409,rejected.text)
  accepted=self.c.post(self.base,headers=self.h,json={"conversation_id":self.conversation,"task_id":"cost","preflight_turn_id":preflight})
  self.assertEqual(accepted.status_code,200,accepted.text)
 def test_editing_internal_flow_cannot_remove_initial_analysis(self):
  cfg=self.c.get(self.stage+"/flows",headers=self.h).json();definition=copy.deepcopy(cfg["active"]["definition"])
  task=next(t for t in definition["tasks"] if t["id"]=="cost")
  task.update(prompt="立即生成成本表",taskbook_md="# 立即计算成本，不核对现状",require_sources=True)
  draft=self.c.post(self.stage+"/flows/draft",headers=self.h,json={"expected_revision":0,"base_version_id":cfg["active"]["id"],"definition":definition})
  self.assertEqual(draft.status_code,200,draft.text)
  # Even a customized workflow still has a separate read-only preflight first.
  r=self.start(draft.json()["id"]);self.assertTrue(r["trial"])

if __name__=="__main__":unittest.main()
