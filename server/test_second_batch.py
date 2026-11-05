"""Second-batch project administration and document-type regression."""
import os
import tempfile
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


class SecondBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        response = cls.client.post("/api/session", json={"username": "pm", "password": "demo2026"})
        cls.headers = {"Authorization": "Bearer " + response.json()["token"]}

    def test_unique_name_edit_and_delete_project(self):
        identifier = "P2-" + uuid.uuid4().hex[:8]
        name = "第二批项目-" + uuid.uuid4().hex[:8]
        response = self.client.post("/api/access/projects", headers=self.headers, json={"id": identifier, "name": name, "scope": "测试范围", "owner_role": "marketing"})
        self.assertEqual(response.status_code, 200, response.text)
        duplicate = self.client.post("/api/access/projects", headers=self.headers, json={"id": identifier + "X", "name": name.upper()})
        self.assertEqual(duplicate.status_code, 409)
        updated = self.client.patch(f"/api/access/projects/{identifier}", headers=self.headers, json={"name": name + "-已修改", "scope": "更新范围", "owner_role": "sales"})
        self.assertEqual(updated.status_code, 200, updated.text)
        detail = self.client.get(f"/api/access/projects/{identifier}", headers=self.headers).json()
        self.assertEqual(detail["scope"], "更新范围")
        self.assertEqual(detail["owner_role"], "sales")
        deleted = self.client.delete(f"/api/access/projects/{identifier}", headers=self.headers)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        projects = self.client.get("/api/me", headers=self.headers).json()["projects"]
        self.assertNotIn(identifier, {row["id"] for row in projects})

    def test_document_type_saved_and_agent_suggestion_editable(self):
        project = "P2-" + uuid.uuid4().hex[:8]
        self.client.post("/api/access/projects", headers=self.headers, json={"id": project, "name": project})
        with patch("document_lifecycle.request_chat", return_value="摘要"):
            response = self.client.post(f"/api/projects/{project}/documents", headers=self.headers, data={"title": "IO 点表", "version": "V1", "business_type": "点表与配置"}, files={"file": ("io.txt", b"DI DO AI AO", "text/plain")})
        self.assertEqual(response.status_code, 200, response.text)
        registered = self.client.post(f"/api/projects/{project}/documents/{response.json()['id']}/register", headers=self.headers, json={"mode": "input", "stage_id": "*", "usage": "批量上传"})
        self.assertEqual(registered.status_code, 200, registered.text)
        rows = self.client.get(f"/api/projects/{project}/documents", headers=self.headers).json()
        self.assertEqual(rows[0]["business_type"], "点表与配置")
        model = ModelConfig("deepseek", "fixture", "https://example.invalid", "fixture")
        with patch("document_lifecycle.model_config", return_value=model), patch("document_lifecycle.request_chat", return_value='{"type":"规格与要求","reason":"正文是技术规格"}'):
            suggestion = self.client.post("/api/documents/suggest-type", headers=self.headers, json={"title": "技术规格书", "description": "客户要求", "excerpt": "技术规格"})
        self.assertEqual(suggestion.status_code, 200, suggestion.text)
        self.assertEqual(suggestion.json()["type"], "规格与要求")


if __name__ == "__main__":
    unittest.main()
