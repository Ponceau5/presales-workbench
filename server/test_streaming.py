"""Heartbeat liveness and 20 simultaneous admitted model streams, without provider traffic."""
import os,tempfile,json,time,threading,unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
root=tempfile.TemporaryDirectory(dir=os.getenv("PRESALES_TEST_TMP"))
os.environ["PRESALES_DATA_DIR"]=root.name
from streaming import heartbeat_stream,event
from model_gateway import ModelConfig
import agent_engine

class StreamingTests(unittest.TestCase):
 def test_heartbeat_and_deadline(self):
  def slow():
   time.sleep(.12);yield event("done")
  events=list(heartbeat_stream(slow(),interval=.01,deadline=.04))
  self.assertIn('"heartbeat"',"".join(events))
  self.assertIn('"error"',events[-1])
  time.sleep(.14)
 def test_disconnect_closes_source(self):
  closed=threading.Event()
  def source():
   try:
    while True:
     time.sleep(.005);yield event("delta",text="a")
   finally:closed.set()
  stream=heartbeat_stream(source(),interval=.01)
  next(stream);stream.close()
  self.assertTrue(closed.wait(1))
 def test_eighty_reply_connections_are_accepted_without_more_model_slots(self):
  barrier=threading.Barrier(80,timeout=10)
  def source():
   barrier.wait()
   yield event("done")
  def consume(_):return "".join(heartbeat_stream(source(),interval=.05))
  with ThreadPoolExecutor(max_workers=80) as workers:
   replies=list(workers.map(consume,range(80)))
  self.assertTrue(all('"done"' in value and '"error"' not in value for value in replies))
 def test_twenty_concurrent_model_streams(self):
  barrier=threading.Barrier(20,timeout=10);lock=threading.Lock();active=0;peak=0
  def model(*args):
   nonlocal active,peak
   with lock:active+=1;peak=max(peak,active)
   try:
    barrier.wait()
    time.sleep(.04)
    yield {"type":"delta","text":args[3]}
   finally:
    with lock:active-=1
  def request(index):
   text="private-user-"+str(index)
   output="".join(agent_engine.request_agent_stream([{"role":"user","content":text}],user=text,project="fixture",stage="F7",sources=[]))
   return output
  with patch("agent_engine.access_control.check_project"),patch("agent_engine.model_config",return_value=ModelConfig("zhipu","fixture","https://example.invalid","fixture")),patch("agent_engine.snapshot_tools",return_value=[]),patch("agent_engine.chat_model",return_value=None),patch("agent_engine.stream_agent",side_effect=model):
   with ThreadPoolExecutor(max_workers=20) as pool:outputs=list(pool.map(request,range(20)))
  self.assertEqual(peak,20)
  self.assertEqual(outputs,["private-user-"+str(i) for i in range(20)])
  print("Application model admission: 20 concurrent streams, peak =",peak)
class ConcurrentApiTests(unittest.TestCase):
 def test_twenty_users_f7_http_and_checkpoint_isolation(self):
  from fastapi.testclient import TestClient
  from app import app,db
  from uuid import uuid4
  client=TestClient(app)
  admin={"Authorization":"Bearer "+client.post("/api/session",json={"username":"pm","password":"demo2026"}).json()["token"]}
  headers=[]
  tag=uuid4().hex[:6]
  for i in range(20):
   user="load_"+tag+"_"+str(i)
   r=client.post("/api/access/users",headers=admin,json={"username":user,"display_name":user,"role":"admin","password":"fixture2026"})
   self.assertEqual(r.status_code,200,r.text)
   r=client.post("/api/session",json={"username":user,"password":"fixture2026"})
   self.assertEqual(r.status_code,200,r.text)
   headers.append({"Authorization":"Bearer "+r.json()["token"]})
  barrier=threading.Barrier(20,timeout=20)
  active=0;peak=0;lock=threading.Lock()
  def fake_model(*args,**kwargs):
   nonlocal active,peak
   with lock:active+=1;peak=max(peak,active)
   try:
    barrier.wait()
    yield "private output for "+kwargs["user"]
   finally:
    with lock:active-=1
  turns=[uuid4().hex for _ in range(20)]
  def ask(i):
   return client.post("/api/projects/GSA02/workspaces/F7/ask-stream",headers=headers[i],json={"question":"核对当前资料","task_id":"materials-survey","turn_id":turns[i]})
  with patch("workspace_router.model_config",return_value=ModelConfig("zhipu","fixture","mock","fixture")),patch("workspace_router.request_agent_stream",side_effect=fake_model):
   with ThreadPoolExecutor(max_workers=20) as pool:responses=list(pool.map(ask,range(20)))
  for i,response in enumerate(responses):
   self.assertEqual(response.status_code,200,response.text)
   self.assertIn('"type": "done"',response.text)
   self.assertIn("load_"+tag+"_"+str(i),response.text)
  with db() as c:
   rows=c.execute("SELECT actor,content FROM workspace_replies WHERE id IN ("+",".join("?"*20)+")",turns).fetchall()
   self.assertEqual(len(rows),20)
   self.assertTrue(all(row["actor"] in row["content"] for row in rows))
  self.assertEqual(peak,20)
  print("HTTP: 20 authenticated users, 20 F7 checkpoints and isolated persisted replies, peak =",peak)

if __name__=="__main__":unittest.main()
