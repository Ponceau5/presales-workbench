"""Local API contract tests with synthetic source text only."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfWriter

TEMP = tempfile.TemporaryDirectory()
os.environ["PRESALES_DATA_DIR"] = TEMP.name

from app import app, db  # noqa: E402
from kimi import KimiError  # noqa: E402


class WorkflowApiTest(unittest.TestCase):
    def test_server_model_connection_uses_no_project_source(self):
        without_key = self.client.post("/api/model/test", headers=self.auth("software"))
        self.assertEqual(without_key.status_code, 502)
        with patch("app.test_connection") as probe:
            result = self.client.post("/api/model/test", headers=self.auth("software"))
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["connected"])
        probe.assert_called_once_with()

    def test_kimi_extract_is_source_grounded_and_never_overwrites_review(self):
        source = "BMS platform shall provide alarm history retrieval for operator review.\n"
        uploaded = self.client.post(
            "/api/projects/KIMI-TEST/documents",
            headers=self.auth("software"),
            data={"title": "BMS sample", "version": "V1"},
            files={"file": ("sample.txt", source.encode(), "text/plain")},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        document_id = uploaded.json()["id"]
        endpoint = f"/api/documents/{document_id}/extract-live"
        self.assertEqual(self.client.post(
            endpoint, headers=self.auth("dev"), json={"pages": [1]},
        ).status_code, 403)
        self.assertEqual(self.client.post(
            endpoint, headers=self.auth("software"), json={"pages": [1]},
        ).status_code, 503)
        quote = source.strip()
        with patch.dict(os.environ, {"MOONSHOT_API_KEY": "test-placeholder"}), patch(
            "app.extract_requirements", return_value=[
                {"quote": quote, "requirement": "支持告警历史检索"},
                {"quote": "fabricated source", "requirement": "虚构的要求"},
            ],
        ):
            extracted = self.client.post(
                endpoint, headers=self.auth("software"), json={"pages": [1]},
            )
            self.assertEqual(extracted.status_code, 200, extracted.text)
            self.assertEqual(extracted.json()["candidate_count"], 1)
            self.assertEqual(extracted.json()["skipped_count"], 1)
            rows = self.client.get(
                "/api/projects/KIMI-TEST/requirements", headers=self.auth("software"),
            ).json()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["extractor"], "kimi")
            self.assertEqual(rows[0]["quote"], quote)
            progress = self.client.get(
                "/api/projects/KIMI-TEST/progress", headers=self.auth("software"),
            ).json()
            self.assertEqual(progress["status"], "待核对原文")
            self.assertEqual(progress["last_run"]["candidate_count"], 1)
            verified = self.client.post(
                f"/api/requirements/{rows[0]['id']}/verify",
                headers=self.auth("software"),
                json={"expected_revision": 1, "requirement": rows[0]["text"],
                      "note": "逐字核对来源"},
            )
            self.assertEqual(verified.status_code, 200, verified.text)
            self.assertEqual(self.client.post(
                endpoint, headers=self.auth("software"), json={"pages": [1]},
            ).status_code, 409)

    def test_kimi_failure_preserves_existing_candidates(self):
        source = "BMS platform shall provide alarm history retrieval for operator review.\n"
        uploaded = self.client.post(
            "/api/projects/KIMI-FAIL/documents", headers=self.auth("software"),
            data={"title": "BMS sample", "version": "V1"},
            files={"file": ("sample.txt", source.encode(), "text/plain")},
        )
        document_id = uploaded.json()["id"]
        self.client.post(f"/api/documents/{document_id}/extract",
                         headers=self.auth("software"))
        with patch.dict(os.environ, {"MOONSHOT_API_KEY": "test-placeholder"}), patch(
            "app.extract_requirements", side_effect=KimiError("模型临时不可用"),
        ):
            response = self.client.post(
                f"/api/documents/{document_id}/extract-live",
                headers=self.auth("software"), json={"pages": [1]},
            )
            self.assertEqual(response.status_code, 502)
        rows = self.client.get(
            "/api/projects/KIMI-FAIL/requirements", headers=self.auth("software"),
        ).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["extractor"], "mock")
        progress = self.client.get(
            "/api/projects/KIMI-FAIL/progress", headers=self.auth("software"),
        ).json()
        self.assertEqual(progress["last_run"]["status"], "failed")

    def test_kimi_empty_result_preserves_existing_candidates(self):
        uploaded = self.client.post(
            "/api/projects/KIMI-EMPTY/documents", headers=self.auth("software"),
            data={"title": "BMS sample", "version": "V1"},
            files={"file": ("sample.txt", b"alarm server requirement must be reviewed", "text/plain")},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        document_id = uploaded.json()["id"]
        before = self.client.post(
            f"/api/documents/{document_id}/extract", headers=self.auth("software"),
        ).json()["requirements"]
        self.assertTrue(before)
        with patch.dict(os.environ, {"MOONSHOT_API_KEY": "test-placeholder"}), patch(
            "app.extract_requirements", return_value=[],
        ):
            result = self.client.post(
                f"/api/documents/{document_id}/extract-live",
                headers=self.auth("software"), json={"pages": [1]},
            )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["candidate_count"], 0)
        after = self.client.get(
            "/api/projects/KIMI-EMPTY/requirements", headers=self.auth("software"),
        ).json()
        self.assertEqual({row["id"] for row in after}, {row["id"] for row in before})

    def test_local_demo_source_import_is_explicit_and_idempotent(self):
        source = Path(TEMP.name) / "sample.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        with source.open("wb") as handle:
            writer.write(handle)
        os.environ["PRESALES_DEMO_BMS_FILE"] = str(source)
        try:
            denied = self.client.post(
                "/api/projects/RCJM1/demo-source", headers=self.auth("dev")
            )
            self.assertEqual(denied.status_code, 403)
            first = self.client.post(
                "/api/projects/RCJM1/demo-source", headers=self.auth("software")
            )
            self.assertEqual(first.status_code, 200, first.text)
            self.assertFalse(first.json()["already_imported"])
            second = self.client.post(
                "/api/projects/RCJM1/demo-source", headers=self.auth("software")
            )
            self.assertEqual(second.json()["id"], first.json()["id"])
            self.assertTrue(second.json()["already_imported"])
        finally:
            os.environ.pop("PRESALES_DEMO_BMS_FILE", None)

    def test_browser_origin_preflight(self):
        response = self.client.options(
            "/api/session",
            headers={"Origin": "http://127.0.0.1:3000",
                     "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"],
                         "http://127.0.0.1:3000")

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.tokens = {}
        for username in ("sales", "software", "dev", "solution"):
            result = cls.client.post(
                "/api/session", json={"username": username, "password": "demo2026"}
            )
            assert result.status_code == 200
            cls.tokens[username] = result.json()["token"]

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def auth(self, username):
        return {"Authorization": f"Bearer {self.tokens[username]}"}

    def upload(self, text, version):
        return self.client.post(
            "/api/projects/RCJM1/documents",
            headers=self.auth("sales"),
            data={"title": "BMS 技术规格", "version": version},
            files={"file": ("bms-spec.txt", text.encode(), "text/plain")},
        )

    def test_source_review_handoff_publication_and_local_invalidation(self):
        original = (
            "OPC client and server connection shall support plant equipment.\n"
            "Alarm video history shall be available for review and retrieval.\n"
        )
        self.assertEqual(
            self.client.post(
                "/api/projects/RCJM1/documents",
                headers=self.auth("dev"),
                data={"title": "BMS 技术规格", "version": "V1"},
                files={"file": ("source.txt", original.encode(), "text/plain")},
            ).status_code,
            403,
        )
        uploaded = self.upload(original, "V1")
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        document_id = uploaded.json()["id"]
        source = self.client.get(
            f"/api/documents/{document_id}/pages/1", headers=self.auth("software")
        )
        self.assertIn("Alarm video history", source.json()["text"])
        extracted = self.client.post(
            f"/api/documents/{document_id}/extract", headers=self.auth("software")
        )
        self.assertEqual(extracted.status_code, 200, extracted.text)
        self.assertEqual(extracted.json()["coverage"], "keyword_only")
        candidates = extracted.json()["requirements"]
        self.assertEqual(len(candidates), 2)
        with db() as connection:
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM document_pages WHERE document_id=?",
                (document_id,),
            ).fetchone()[0], 1)
        refreshed = self.client.post(
            f"/api/documents/{document_id}/extract?force=true",
            headers=self.auth("software"),
        )
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        candidates = refreshed.json()["requirements"]
        self.assertTrue(any(item["status"] == "待核对" for item in
            self.client.get("/api/tasks", headers=self.auth("software")).json()))
        video = next(item for item in candidates if "video" in item["quote"].lower())
        requirement_id = video["id"]
        verified = self.client.post(
            f"/api/requirements/{requirement_id}/verify",
            headers=self.auth("software"),
            json={"expected_revision": 1, "requirement": video["text"],
                  "note": "已与原文逐句核对"},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(self.client.post(
            f"/api/documents/{document_id}/extract?force=true",
            headers=self.auth("software"),
        ).status_code, 409)
        self.assertEqual(
            self.client.post(
                f"/api/requirements/{requirement_id}/publish",
                headers=self.auth("software"), json={"expected_revision": 2},
            ).status_code,
            409,
        )
        handoffs = {}
        for owner in ("sales", "dev"):
            result = self.client.post(
                f"/api/requirements/{requirement_id}/handoffs",
                headers=self.auth("software"),
                json={"owner": owner, "question": "请确认视频回溯范围"},
            )
            self.assertEqual(result.status_code, 200, result.text)
            handoffs[owner] = result.json()["id"]
        self.assertTrue(any(item["status"] == "待答复" for item in
            self.client.get("/api/tasks", headers=self.auth("sales")).json()))
        decision = {"expected_revision": 2, "action": "approve",
                    "disposition": "待澄清后有条件响应",
                    "customer_answer": "按确认的追溯范围提供调取能力。",
                    "note": "软件产品已核对客户口径"}
        self.assertEqual(
            self.client.post(
                f"/api/requirements/{requirement_id}/decision",
                headers=self.auth("software"), json=decision,
            ).status_code,
            409,
        )
        for owner, handoff_id in handoffs.items():
            self.assertEqual(
                self.client.post(
                    f"/api/handoffs/{handoff_id}/reply",
                    headers=self.auth("solution"),
                    json={"answer": "无权替代答复"},
                ).status_code,
                403,
            )
            reply = self.client.post(
                f"/api/handoffs/{handoff_id}/reply",
                headers=self.auth(owner),
                json={"answer": "范围已按演示假设确认，需客户最终书面确认"},
            )
            self.assertEqual(reply.status_code, 200, reply.text)
        self.assertTrue(any(item["status"] == "待处理答复" for item in
            self.client.get("/api/tasks", headers=self.auth("software")).json()))
        approved = self.client.post(
            f"/api/requirements/{requirement_id}/decision",
            headers=self.auth("software"), json=decision,
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["status"], "approved")
        self.assertEqual(
            self.client.post(
                f"/api/requirements/{requirement_id}/publish",
                headers=self.auth("dev"), json={"expected_revision": 3},
            ).status_code,
            403,
        )
        published = self.client.post(
            f"/api/requirements/{requirement_id}/publish",
            headers=self.auth("software"), json={"expected_revision": 3},
        )
        self.assertEqual(published.status_code, 200, published.text)
        active_facts = self.client.get(
            "/api/projects/RCJM1/facts", headers=self.auth("software")
        )
        self.assertEqual(len(active_facts.json()), 1)
        project_handoffs = self.client.get(
            "/api/projects/RCJM1/handoffs", headers=self.auth("software")
        )
        self.assertEqual(len(project_handoffs.json()), 2)
        changed = self.upload(
            original.replace("OPC client and server", "OPC  client and server")
            .replace("history shall", "alarm snapshots shall"), "V2"
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()["invalidated"], 1)
        self.assertEqual(self.client.get(
            "/api/projects/RCJM1/facts", headers=self.auth("software")
        ).json(), [])
        with db() as connection:
            old_video = connection.execute(
                "SELECT status FROM requirements WHERE id=?", (requirement_id,)
            ).fetchone()
            fact = connection.execute(
                "SELECT active FROM facts WHERE requirement_id=?", (requirement_id,)
            ).fetchone()
            opc = connection.execute(
                "SELECT status FROM requirements WHERE id=?", (candidates[0]["id"],)
            ).fetchone()
        self.assertEqual(old_video["status"], "stale")
        self.assertEqual(fact["active"], 0)
        self.assertEqual(opc["status"], "candidate")
        events = self.client.get(
            "/api/projects/RCJM1/events", headers=self.auth("software")
        )
        self.assertTrue(any(item["action"] == "fact_published" for item in events.json()))


if __name__ == "__main__":
    unittest.main()
