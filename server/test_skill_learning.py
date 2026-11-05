"""Conversation-to-Skill confirmation, identity boundaries and revision conflicts."""
import os,tempfile,json,unittest
from uuid import uuid4
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv("PRESALES_TEST_TMP"))
os.environ["PRESALES_DATA_DIR"]=root.name
from fastapi.testclient import TestClient
from app import app,db,now

class SkillLearningTests(unittest.TestCase):
 def setUp(self):
  self.client=TestClient(app)
  self.headers={"Authorization":"Bearer "+self.client.post("/api/session",json={"username":"pm","password":"demo2026"}).json()["token"]}
  self.base="/api/projects/GSA02/workspaces/F7/flows"
  with db() as c:c.execute("DELETE FROM flow_drafts WHERE project_id='GSA02' AND stage='F7' AND author='pm'")
  self.cfg=self.client.get(self.base,headers=self.headers).json()
  self.task=self.cfg["active"]["definition"]["tasks"][0]
  self.source=uuid4().hex
  with db() as c:c.execute("INSERT INTO workspace_replies (id,project_id,stage_id,actor,content,sources,created_at,config_id,task_id) VALUES (?,?,?,?,?,?,?,?,?)",
   (self.source,"GSA02","F7","pm","满意输出：逐项列来源，缺少采购回价保持待补。","[]",now(),self.cfg["active"]["id"],self.task["id"]))
 def propose(self,**extra):
  body={"question":"把刚才满意的做法更新到Skill","source_turn_ids":[self.source],"turn_id":uuid4().hex,"task_id":self.task["id"],**extra}
  markdown="# 可复用的成本核对流程\n"+"逐项保留资料名称、版本及来源；先核对设备清单，再检查采购回价和币种，缺少依据保持待补，不推断价格。\n"*4
  with patch("skill_learning.request_agent_stream",return_value=iter([json.dumps({"markdown":markdown,"summary":"补充来源检查和缺项处理"})])):
   response=self.client.post(self.base+"/learn-stream",headers=self.headers,json=body)
  return response
 def proposal(self,response):
  self.assertEqual(response.status_code,200,response.text)
  return next(json.loads(s[6:])["data"] for s in response.text.splitlines() if s.startswith("data: ") and json.loads(s[6:])["type"]=="skill_proposal")
 def test_confirm_updates_private_editor_and_preserves_active(self):
  proposal=self.proposal(self.propose())
  before=self.client.get(self.base,headers=self.headers).json()
  self.assertIsNone(before["draft"])
  result=self.client.post(self.base+"/learn/"+proposal["id"]+"/confirm",headers=self.headers)
  self.assertEqual(result.status_code,200,result.text)
  after=self.client.get(self.base,headers=self.headers).json()
  self.assertEqual(after["active"]["id"],before["active"]["id"])
  task=next(t for t in after["draft"]["definition"]["tasks"] if t["id"]==self.task["id"])
  self.assertEqual(task["taskbook_md"],proposal["markdown"])
  self.assertEqual(task["steps"],self.task["steps"])
  self.assertEqual(self.client.post(self.base+"/learn/"+proposal["id"]+"/confirm",headers=self.headers).status_code,200)
 def test_other_actor_or_stage_source_is_rejected(self):
  for column,value in [("actor","someone-else"),("stage_id","F8"),("project_id","RCJM1")]:
   with db() as c:c.execute("UPDATE workspace_replies SET "+column+"=? WHERE id=?",(value,self.source))
   self.assertEqual(self.propose().status_code,404)
   with db() as c:c.execute("UPDATE workspace_replies SET "+column+"=? WHERE id=?",("pm" if column=="actor" else "F7" if column=="stage_id" else "GSA02",self.source))
 def test_concurrent_edit_prevents_overwrite(self):
  proposal=self.proposal(self.propose())
  response=self.client.post(self.base+"/draft",headers=self.headers,json={"expected_revision":0,"base_version_id":self.cfg["active"]["id"],"definition":self.cfg["active"]["definition"]})
  self.assertEqual(response.status_code,200,response.text)
  self.assertEqual(self.client.post(self.base+"/learn/"+proposal["id"]+"/confirm",headers=self.headers).status_code,409)
 def test_discard_does_not_write_draft(self):
  proposal=self.proposal(self.propose())
  self.assertEqual(self.client.post(self.base+"/learn/"+proposal["id"]+"/discard",headers=self.headers).status_code,200)
  self.assertEqual(self.client.post(self.base+"/learn/"+proposal["id"]+"/confirm",headers=self.headers).status_code,409)
  self.assertIsNone(self.client.get(self.base,headers=self.headers).json()["draft"])
 def test_completed_trial_is_valid_but_another_actors_trial_is_not(self):
  trial=uuid4().hex
  with db() as c:c.execute("INSERT INTO flow_trials VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
   (trial,"GSA02","F7","pm","fixture","fixture","{}","test","Trial output","completed",0,"",now()))
  self.proposal(self.propose(source_turn_ids=[trial]))
  with db() as c:c.execute("UPDATE flow_trials SET actor='another' WHERE id=?",(trial,))
  self.assertEqual(self.propose(source_turn_ids=[trial]).status_code,404)
 def test_model_cannot_change_tools_or_break_structured_steps(self):
  output={"markdown":"# Skill\n"+"先读资料再核对来源，缺少参数时要求确认。"*10,"summary":"完善核对步骤",
          "changes":{"steps":"沿用原步骤","parameters":"沿用参数","require_sources":False}}
  with patch("skill_learning.request_agent_stream",return_value=iter([json.dumps(output)])):
   response=self.client.post(self.base+"/learn-stream",headers=self.headers,json={"question":"更新 Skill","source_turn_ids":[self.source],"turn_id":uuid4().hex,"task_id":self.task["id"]})
   proposal=self.proposal(response)
  self.assertEqual(self.client.post(self.base+"/learn/"+proposal["id"]+"/confirm",headers=self.headers).status_code,200)
  saved=self.client.get(self.base,headers=self.headers).json()["draft"]["definition"]["tasks"][0]
  self.assertEqual(saved["steps"],self.task["steps"])
  self.assertEqual(saved["parameters"],self.task["parameters"])
  self.assertEqual(saved["require_sources"],self.task["require_sources"])
 def test_replay_does_not_generate_twice(self):
  turn=uuid4().hex;first=self.proposal(self.propose(turn_id=turn))
  with patch("skill_learning.request_agent_stream",side_effect=AssertionError("must replay")):
   second=self.proposal(self.propose(turn_id=turn))
  self.assertEqual(first["id"],second["id"])

if __name__=="__main__":unittest.main()
