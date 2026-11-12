"""HTTP validation must reject bad JSON without reflecting user payloads."""
import os,tempfile,unittest
root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from fastapi.testclient import TestClient
from app import app
class HttpValidationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.client=TestClient(app,raise_server_exceptions=False)
  r=cls.client.post('/api/session',json={'username':'pm','password':'demo2026'})
  cls.headers={'Authorization':'Bearer '+r.json()['token']}
 def test_nonfinite_json_returns_422(self):
  for value in ('NaN','Infinity','-Infinity'):
   r=self.client.post('/api/knowledge/ask',headers={**self.headers,'Content-Type':'application/json'},content='{"question":'+value+'}')
   self.assertEqual(r.status_code,422,r.text)
 def test_validation_does_not_echo_input(self):
  r=self.client.post('/api/knowledge/ask',headers=self.headers,json={'question':'x','history':[{'role':'system','text':'SECRET_FIXTURE_DO_NOT_ECHO'}]})
  self.assertEqual(r.status_code,422);self.assertNotIn('SECRET_FIXTURE_DO_NOT_ECHO',r.text)
  self.assertNotIn('"input"',r.text)
 def test_malformed_json(self):
  r=self.client.post('/api/knowledge/ask',headers={**self.headers,'Content-Type':'application/json'},content='{')
  self.assertEqual(r.status_code,422)
 def test_anonymous_rejected(self):
  for url in ('/api/knowledge/documents','/api/global-business','/api/access/overview'):
   self.assertEqual(self.client.get(url).status_code,401)
 def test_oversized_metadata(self):
  r=self.client.post('/api/knowledge/documents',headers=self.headers,data={'title':'x'*241},files={'file':('a.md',b'fixture')})
  self.assertEqual(r.status_code,422)
if __name__=='__main__':unittest.main()
