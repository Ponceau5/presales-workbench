import json, sqlite3, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import httpx
import log_viewer
from database import connect

class LogViewerTests(unittest.TestCase):
 def test_unauthenticated(self):
  with TestClient(log_viewer.app) as c:self.assertEqual(c.get('/api/logs').status_code,401)
 def test_non_admin(self):
  async def get(*args,**kwargs):return httpx.Response(200,json={'is_admin':False})
  with patch.object(httpx.AsyncClient,'get',get),TestClient(log_viewer.app) as c:
   c.cookies.set('presales_source_session','fixture');self.assertEqual(c.get('/api/logs').status_code,403)
 def test_paging_filter_redaction(self):
  async def admin():pass
  with tempfile.TemporaryDirectory(dir=__import__('os').getenv('PRESALES_TEST_TMP','/Users/a48750/Desktop/AI专用/Codex/售前Agent本地运行')) as folder:
   p=Path(folder)/'test.sqlite3'
   with connect(p) as c:
    c.execute('CREATE TABLE execution_metrics(id TEXT,project_id TEXT,stage_id TEXT,actor TEXT,status TEXT,created_at TEXT,details TEXT,reason TEXT,total_seconds REAL)')
    for i in range(32):c.execute('INSERT INTO execution_metrics VALUES(?,?,?,?,?,?,?,?,?)',(str(i),'P1','F5','fixture','failed','2026-10-29',json.dumps([{'metric':'provider_error','http_status':402,'secret':'must-not-appear'}]),'失败',1))
    c.execute("INSERT INTO execution_metrics VALUES('other','P2','F1','other','completed','2026-10-29','[]','',1)")
   log_viewer.app.dependency_overrides[log_viewer.administrator]=admin
   try:
    with patch.object(log_viewer,'DB_PATH',p),TestClient(log_viewer.app) as c:
     r=c.get('/api/logs?project=P1&status=failed&page=2');d=r.json()
     self.assertEqual(d['total'],32);self.assertEqual(len(d['rows']),2)
     self.assertIn('余额不足',d['rows'][0]['diagnosis']);self.assertNotIn('must-not-appear',r.text)
     self.assertEqual(r.headers['cache-control'],'no-store');self.assertEqual(c.get('/api/logs?page=0').status_code,422)
   finally:log_viewer.app.dependency_overrides.clear()
