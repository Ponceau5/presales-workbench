import json, sqlite3, unittest
from contextlib import contextmanager
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import project_assistant

class ProjectAssistantTests(unittest.TestCase):
    def setUp(self):
        self.role_patch=patch.object(project_assistant,'role_of',return_value='sales');self.role_patch.start()
        self.connection=sqlite3.connect(':memory:',check_same_thread=False)
        self.connection.row_factory=sqlite3.Row
        self.connection.executescript('CREATE TABLE shared_workbench_state(id INTEGER DEFAULT 1,value TEXT,revision INTEGER DEFAULT 1,updated_at TEXT); CREATE TABLE documents(id,title,version,project_id,created_at); CREATE TABLE document_pages(document_id,page,text); CREATE TABLE workspace_artifacts(title,stage_id,revision,content,project_id,created_at);')
        self.connection.execute('INSERT INTO shared_workbench_state(value) VALUES (?)',(json.dumps({'projects':[{'id':'A','name':'Project A'},{'id':'B','name':'Private B'}]}),))
        self.connection.execute("INSERT INTO documents VALUES ('a','A list','V1','A','now')")
        self.connection.execute("INSERT INTO documents VALUES ('b','Private B document','V1','B','now')")
        self.connection.commit()
        @contextmanager
        def db():
            with self.connection:yield self.connection
        app=FastAPI();project_assistant.install(app,db,lambda:'reader')
        self.client=TestClient(app)
    def tearDown(self):self.role_patch.stop();self.connection.close()
    def test_read_only_member_uses_model_with_selected_project_only(self):
        with patch.object(project_assistant,'check_project') as access,patch.object(project_assistant,'filter_shared',side_effect=lambda s,a:s),patch.object(project_assistant,'request_chat',return_value='{"answer":"A list V1","proposal":null}') as model:
            r=self.client.post('/api/project-assistant',json={'project_id':'A','question':'资料有哪些'})
            self.assertEqual(r.status_code,200);access.assert_called_once_with('reader','A')
            context=model.call_args.args[0][1]['content']
            self.assertNotIn('Private B',context);self.assertIn('A list',context)
    def test_denied_project_never_calls_model(self):
        with patch.object(project_assistant,'check_project',side_effect=HTTPException(403,'禁止')),patch.object(project_assistant,'request_chat') as model:
            self.assertEqual(self.client.post('/api/project-assistant',json={'project_id':'B','question':'资料'}).status_code,403)
            model.assert_not_called()
    def test_change_is_a_proposal_and_never_writes(self):
        before=self.connection.total_changes
        with patch.object(project_assistant,'check_project'),patch.object(project_assistant,'filter_shared',side_effect=lambda s,a:s),patch.object(project_assistant,'request_chat',return_value='{"answer":"请确认","proposal":{"title":"新增网关一台","kind":"客户变更"}}'):
            result=self.client.post('/api/project-assistant',json={'project_id':'A','question':'客户新增网关一台'})
            self.assertEqual(result.json()['proposal']['title'],'新增网关一台')
            self.assertEqual(self.connection.total_changes,before)

    def test_member_record_is_persisted_and_idempotent(self):
        with patch.object(project_assistant,'check_project'):
            payload={'id':'msg1','project_id':'A','title':'新增网关一台','owner':'解决方案','kind':'客户变更'}
            first=self.client.post('/api/project-assistant/records',json=payload)
            self.assertEqual(first.status_code,200,first.text)
            self.assertEqual(self.client.post('/api/project-assistant/records',json=payload).json()['id'],first.json()['id'])
            state=json.loads(self.connection.execute('SELECT value FROM shared_workbench_state').fetchone()[0])
            self.assertEqual(len(state['followups']),1)
            self.assertEqual(state['followups'][0]['createdBy'],'reader')
            self.assertEqual(state['followups'][0]['projectId'],'A')
    def test_denied_member_cannot_record(self):
        with patch.object(project_assistant,'check_project',side_effect=HTTPException(403,'禁止')):
            result=self.client.post('/api/project-assistant/records',json={'id':'msg2','project_id':'B','title':'变更','owner':'销售'})
            self.assertEqual(result.status_code,403)
