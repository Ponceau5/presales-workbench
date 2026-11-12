"""The software-stage routes only expose data of the project in the path."""
import os, tempfile, unittest, uuid
os.environ.setdefault('PRESALES_TEST_TMP', tempfile.mkdtemp(prefix='gsa-isolation-'))
from fastapi.testclient import TestClient
from app import app, db, now
import identity_provider
identity_provider._config = None

A, B = 'ISO_A', 'ISO_B'


class GsaIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.headers = {'Authorization': 'Bearer ' + cls.client.post(
            '/api/session', json={'username': 'pm', 'password': 'demo2026'}).json()['token']}
        cls.run_a, cls.run_b = str(uuid.uuid4()), str(uuid.uuid4())
        with db() as c:
            for project in (A, B):
                c.execute("INSERT OR IGNORE INTO access_projects(id,name,archived,created_at) VALUES (?,?,0,?)",
                          (project, project, now()))
            # 未配置统一登录的会话只读本账号可见的项目，管理员可见全部。
            for identifier, project in ((cls.run_a, A), (cls.run_b, B)):
                c.execute("INSERT INTO sizing_runs(id,project_id,actor,status,inputs,calculation,provider,model,source_hashes,created_at) "
                          "VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (identifier, project, 'pm', 'review', '{}', '{"low":{},"high":{},"inputs":{}}',
                           'deepseek', 'test', '[]', now()))
                c.execute("INSERT INTO sizing_audit(id,run_id,actor,action,detail,created_at,project_id) VALUES (?,?,?,?,?,?,?)",
                          (str(uuid.uuid4()), identifier, 'pm', 'start', project, now(), project))

    @classmethod
    def tearDownClass(cls):
        with db() as c:
            c.execute("DELETE FROM sizing_runs WHERE id IN (?,?)", (cls.run_a, cls.run_b))
            c.execute("DELETE FROM sizing_audit WHERE run_id IN (?,?)", (cls.run_a, cls.run_b))
            c.execute("DELETE FROM access_projects WHERE id IN (?,?)", (A, B))

    def test_runs_are_scoped_to_the_path_project(self):
        runs = self.client.get(f'/api/projects/{A}/software/runs', headers=self.headers)
        self.assertEqual(runs.status_code, 200, runs.text)
        self.assertEqual([item['id'] for item in runs.json()], [self.run_a])

    def test_other_project_run_is_not_found(self):
        for path in (f'/api/projects/{A}/software/runs/{self.run_b}',
                     f'/api/projects/{B}/software/runs/{self.run_a}'):
            self.assertEqual(self.client.get(path, headers=self.headers).status_code, 404, path)

    def test_audit_is_scoped_to_the_path_project(self):
        for project, run in ((A, self.run_a), (B, self.run_b)):
            audits = self.client.get(f'/api/projects/{project}/software/audit', headers=self.headers)
            self.assertEqual(audits.status_code, 200, audits.text)
            self.assertEqual({item['run_id'] for item in audits.json()}, {run})

    def test_decision_cannot_touch_other_project_run(self):
        response = self.client.post(f'/api/projects/{A}/software/runs/{self.run_b}/decision',
                                    headers=self.headers,
                                    json={'expected_revision': 1, 'action': 'reject', 'note': '越权检查'})
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == '__main__':
    unittest.main()
