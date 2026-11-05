"""Regression for explicit document lifecycle, query Skill trials and artifact catalog."""
import json
import os
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

root = tempfile.TemporaryDirectory(dir=os.getenv("PRESALES_TEST_TMP"))
os.environ["PRESALES_DATA_DIR"] = root.name
for prefix in ("ZHIPU", "DEEPSEEK", "MOONSHOT", "SILICONFLOW"):
    os.environ[prefix + "_API_KEY"] = ""

from fastapi.testclient import TestClient
from app import app
from model_gateway import ModelConfig


class PriorityRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        response = cls.client.post("/api/session", json={"username": "pm", "password": "demo2026"})
        cls.headers = {"Authorization": "Bearer " + response.json()["token"]}

    def setUp(self):
        self.project = "P-" + uuid.uuid4().hex[:8]
        response = self.client.post("/api/access/projects", headers=self.headers, json={"id": self.project, "name": self.project})
        self.assertEqual(response.status_code, 200, response.text)

    def upload(self, title, version, text):
        with patch("document_lifecycle.request_chat", return_value=version + " 的 Agent 摘要"):
            response = self.client.post(
                f"/api/projects/{self.project}/documents",
                headers=self.headers,
                data={"title": title, "version": version},
                files={"file": (title + ".txt", text.encode(), "text/plain")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            identifier = response.json()["id"]
            self.wait_analysis(identifier)
        return identifier

    def wait_analysis(self, identifier):
        for _ in range(100):
            response = self.client.get(f"/api/documents/{identifier}/analysis", headers=self.headers)
            body = response.json()
            if body["status"] == "ready":
                self.assertTrue(body["summary"])
                return body
            if body["status"] == "failed":
                self.fail(body["error"])
            time.sleep(.03)
        self.fail("analysis did not finish")

    def test_explicit_update_disables_history_and_keeps_summary(self):
        first = self.upload("需求资料", "V1", "唯一标记 ALPHA，阈值 37")
        second = self.upload("其他资料", "V1", "不应被停用")
        with patch("document_lifecycle.request_chat", return_value="V2 的 Agent 摘要"):
            response = self.client.put(
                f"/api/documents/{first}",
                headers=self.headers,
                data={},
                files={"file": ("需求资料.txt", b"unique BETA threshold 52", "text/plain")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["version"], "V2")
            updated = response.json()["id"]
            self.wait_analysis(updated)
        rows = self.client.get(f"/api/projects/{self.project}/documents", headers=self.headers).json()
        by_id = {row["id"]: row for row in rows}
        self.assertEqual(by_id[first]["category"], "disabled")
        self.assertEqual(by_id[updated]["category"], "input")
        self.assertEqual(by_id[second]["category"], "input")
        self.assertEqual(by_id[updated]["analysis_summary"], "V2 的 Agent 摘要")
        catalog = self.client.get(f"/api/projects/{self.project}/workspaces/F1/materials", headers=self.headers).json()
        ids = {row["id"] for row in catalog["inputs"]}
        self.assertNotIn(first, ids)
        self.assertIn(updated, ids)
        response = self.client.post(f"/api/documents/{updated}/disable", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.get(f"/api/documents/{updated}/download", headers=self.headers).content)
        catalog = self.client.get(f"/api/projects/{self.project}/workspaces/F1/materials", headers=self.headers).json()
        self.assertNotIn(updated, {row["id"] for row in catalog["inputs"]})

    def test_query_skill_conversion_cannot_add_review_or_export(self):
        base = f"/api/projects/{self.project}/workspaces/F1/flows"
        config = self.client.get(base, headers=self.headers).json()["active"]
        converted = {
            "name": "项目资料摸排",
            "prompt": "核对当前项目资料",
            "inputs": "项目资料",
            "output": "资料清单",
            "acceptance": "来源清楚",
            "require_sources": False,
            "parameters": [],
            "steps": [
                {"id": "inputs", "name": "核对资料", "capability": "inputs", "rule": "", "enabled": True},
                {"id": "review", "name": "错误步骤", "capability": "review", "rule": "", "enabled": True},
                {"id": "generate", "name": "生成回复", "capability": "generate", "rule": "", "enabled": True},
                {"id": "export", "name": "错误步骤", "capability": "export", "rule": "", "enabled": True},
            ],
        }
        model = ModelConfig("deepseek", "fixture", "https://example.invalid", "fixture")
        with patch("model_gateway.model_config", return_value=model), patch("model_gateway.request_chat_stream", return_value=iter([json.dumps(converted)])):
            response = self.client.post(base + "/skill", headers=self.headers, json={
                "definition": config["definition"],
                "task_id": "materials-survey",
                "markdown": "# 项目资料摸排\n只查询，不生成工件。",
                "expected_revision": 0,
                "base_version_id": config["id"],
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([step["capability"] for step in response.json()["task"]["steps"]], ["inputs", "generate"])

    def test_adopted_artifact_appears_in_project_catalog(self):
        self.upload("项目资料", "V1", "项目事实与依据")
        turn = uuid.uuid4().hex
        content = "|字段|值|\n|---|---|\n|成果|通过|"
        with patch("workspace_router.request_agent_stream", return_value=iter([content])):
            response = self.client.post(
                f"/api/projects/{self.project}/workspaces/F1/ask-stream",
                headers=self.headers,
                json={"question": "生成项目档案", "turn_id": turn, "task_id": "deliverable"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post(
            f"/api/projects/{self.project}/workspaces/F1/artifacts/adopt",
            headers=self.headers,
            json={"source_id": turn, "title": "项目档案", "content": content, "conversation_id": "test"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        artifact = response.json()
        rows = self.client.get(f"/api/projects/{self.project}/artifacts", headers=self.headers).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], artifact["id"])
        self.assertEqual(rows[0]["title"], "项目档案")
        download = self.client.get(f"/api/projects/{self.project}/workspaces/F1/artifacts/{artifact['id']}/download?format=md", headers=self.headers)
        self.assertEqual(download.status_code, 200)


if __name__ == "__main__":
    unittest.main()
