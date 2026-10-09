"""Local API for source-grounded F5 review and cross-role handoffs."""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pypdf import PdfReader
from kimi import KimiError, extract_requirements, model_name, test_connection

def load_local_env() -> None:
    """Load only known server settings from the untracked local env file."""
    path = Path(__file__).resolve().parents[1] / ".env.local"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name in {"MOONSHOT_API_KEY", "MOONSHOT_MODEL", "MOONSHOT_BASE_URL"}:
            os.environ.setdefault(name, value.strip().strip('"').strip("'"))


load_local_env()
DATA_DIR = Path(os.environ.get("PRESALES_DATA_DIR", Path(__file__).parent / ".local"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "workbench.sqlite3"
FILES_DIR = DATA_DIR / "files"
FILES_DIR.mkdir(exist_ok=True)

ROLE_BY_ACCOUNT = {
    "sales": "销售",
    "solution": "解决方案",
    "hardware": "硬件产品",
    "software": "软件产品",
    "commercial": "商务支持",
    "finance": "财务 / 风控",
    "logistics": "货运关务",
    "dev": "研发",
    "legal": "认证 / 法务",
    "pm": "PM / PO",
}
DEMO_PASSWORD = os.environ.get("PRESALES_DEMO_PASSWORD", "demo2026")
SESSIONS: dict[str, str] = {}
app = FastAPI(title="售前工作台 · 本机测试 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
              version TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
              sha256 TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_documents_project_title
              ON documents(project_id, title, created_at);
            CREATE TABLE IF NOT EXISTS document_pages (
              document_id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL,
              PRIMARY KEY(document_id, page),
              FOREIGN KEY(document_id) REFERENCES documents(id)
            );
            CREATE TABLE IF NOT EXISTS requirements (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL,
              page INTEGER NOT NULL, quote TEXT NOT NULL, text TEXT NOT NULL,
              status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
              disposition TEXT, customer_answer TEXT, reviewer TEXT, note TEXT,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(document_id) REFERENCES documents(id)
            );
            CREATE INDEX IF NOT EXISTS ix_requirements_document ON requirements(document_id);
            CREATE TABLE IF NOT EXISTS handoffs (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, requirement_id TEXT NOT NULL,
              sender TEXT NOT NULL, owner TEXT NOT NULL, question TEXT NOT NULL,
              answer TEXT, status TEXT NOT NULL, outdated INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL, answered_at TEXT,
              FOREIGN KEY(requirement_id) REFERENCES requirements(id)
            );
            CREATE TABLE IF NOT EXISTS facts (
              id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL, revision INTEGER NOT NULL,
              document_id TEXT NOT NULL, answer TEXT NOT NULL, disposition TEXT NOT NULL,
              published_by TEXT NOT NULL, published_at TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS audit (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor TEXT NOT NULL,
              action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_runs (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL,
              actor TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL,
              pages TEXT NOT NULL, status TEXT NOT NULL, candidate_count INTEGER NOT NULL DEFAULT 0,
              skipped_count INTEGER NOT NULL DEFAULT 0, error TEXT,
              started_at TEXT NOT NULL, finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_agent_runs_project
              ON agent_runs(project_id, started_at);
            CREATE TABLE IF NOT EXISTS candidate_sources (
              requirement_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
              FOREIGN KEY(requirement_id) REFERENCES requirements(id),
              FOREIGN KEY(run_id) REFERENCES agent_runs(id)
            );
            """
        )


init_db()


def actor(authorization: str = Header(default="")) -> str:
    token = authorization.removeprefix("Bearer ")
    account = SESSIONS.get(token)
    if not account:
        raise HTTPException(status_code=401, detail="请先登录")
    return account


def require_account(account: str, allowed: set[str]) -> None:
    if account not in allowed:
        raise HTTPException(status_code=403, detail="当前岗位无权操作")


def row_or_404(connection: sqlite3.Connection, table: str, identifier: str):
    if table not in {"documents", "requirements", "handoffs"}:
        raise ValueError("Invalid table")
    row = connection.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return row


def log(connection: sqlite3.Connection, project: str, account: str, action: str,
        target: str, detail: str) -> None:
    connection.execute(
        "INSERT INTO audit VALUES (?,?,?,?,?,?,?)",
        (str(uuid4()), project, account, action, target, detail, now()),
    )


class Login(BaseModel):
    username: str
    password: str


@app.post("/api/session")
def login(payload: Login):
    if payload.username not in ROLE_BY_ACCOUNT or not secrets.compare_digest(
        payload.password, DEMO_PASSWORD
    ):
        raise HTTPException(status_code=401, detail="账号或密码不正确")
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = payload.username
    return {"token": token, "account": payload.username,
            "role": ROLE_BY_ACCOUNT[payload.username]}


@app.get("/api/model/status")
def model_status(account: str = Depends(actor)):
    return {"configured": bool(os.environ.get("MOONSHOT_API_KEY", "").strip()),
            "provider": "Kimi", "model": model_name()}


@app.post("/api/model/test")
def model_test(account: str = Depends(actor)):
    try:
        test_connection()
    except KimiError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {"connected": True, "provider": "Kimi", "model": model_name()}


def pages(path: Path) -> list[str]:
    if path.suffix.lower() == ".pdf":
        try:
            return [page.extract_text() or "" for page in PdfReader(str(path)).pages]
        except Exception as error:
            raise HTTPException(status_code=422, detail="PDF 无法提取文本") from error
    try:
        return [path.read_text(encoding="utf-8")]
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=422, detail="文本文件须为 UTF-8") from error


def stored_pages(connection: sqlite3.Connection, document: sqlite3.Row) -> list[str]:
    cached = connection.execute(
        "SELECT text FROM document_pages WHERE document_id=? ORDER BY page",
        (document["id"],),
    ).fetchall()
    if cached:
        return [row["text"] for row in cached]
    parsed = pages(Path(document["path"]))
    connection.executemany(
        "INSERT OR REPLACE INTO document_pages VALUES (?,?,?)",
        [(document["id"], number, text) for number, text in enumerate(parsed, 1)],
    )
    return parsed


@app.post("/api/projects/{project_id}/documents")
async def upload_document(
    project_id: str,
    title: str = Form(...),
    version: str = Form(...),
    file: UploadFile = File(...),
    account: str = Depends(actor),
):
    require_account(account, {"sales", "software", "pm"})
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".txt", ".md"} or not title.strip() or not version.strip():
        raise HTTPException(status_code=422, detail="仅接受有标题和版本的 PDF/UTF-8 文本")
    identifier = str(uuid4())
    destination = FILES_DIR / (identifier + suffix)
    digest = hashlib.sha256()
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="测试版单文件上限 100 MB")
                digest.update(chunk)
                output.write(chunk)
        if not size:
            raise HTTPException(status_code=422, detail="空文件")
        parsed_pages = pages(destination)
        new_text = " ".join("\n".join(parsed_pages).split())
        with db() as connection:
            previous = connection.execute(
                "SELECT id FROM documents WHERE project_id=? AND title=? ORDER BY created_at DESC LIMIT 1",
                (project_id, title.strip()),
            ).fetchone()
            connection.execute(
                "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)",
                (identifier, project_id, title.strip(), version.strip(),
                 Path(file.filename or "source").name, str(destination),
                 digest.hexdigest(), account, now()),
            )
            connection.executemany(
                "INSERT INTO document_pages VALUES (?,?,?)",
                [(identifier, number, text)
                 for number, text in enumerate(parsed_pages, 1)],
            )
            stale = 0
            if previous:
                prior = connection.execute(
                    "SELECT id, quote FROM requirements WHERE document_id=? AND status!='stale'",
                    (previous["id"],),
                ).fetchall()
                for requirement in prior:
                    if " ".join(requirement["quote"].split()) not in new_text:
                        connection.execute(
                            "UPDATE requirements SET status='stale', revision=revision+1, updated_at=? WHERE id=?",
                            (now(), requirement["id"]),
                        )
                        connection.execute(
                            "UPDATE facts SET active=0 WHERE requirement_id=?",
                            (requirement["id"],),
                        )
                        connection.execute(
                            "UPDATE handoffs SET outdated=1 WHERE requirement_id=?",
                            (requirement["id"],),
                        )
                        stale += 1
            log(connection, project_id, account, "document_uploaded", identifier,
                f"{title.strip()} {version.strip()}; 失效要求 {stale} 条")
        return {"id": identifier, "version": version.strip(),
                "sha256": digest.hexdigest(), "invalidated": stale}
    except Exception:
        destination.unlink(missing_ok=True)
        raise


@app.get("/api/projects/{project_id}/documents")
def list_documents(project_id: str, account: str = Depends(actor)):
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT d.id, d.title, d.version, d.filename, d.sha256, d.actor, d.created_at, "
            "(SELECT COUNT(*) FROM document_pages p WHERE p.document_id=d.id) AS page_count "
            "FROM documents d WHERE d.project_id=? ORDER BY d.created_at DESC", (project_id,),
        )]


@app.post("/api/projects/{project_id}/demo-source")
async def import_demo_source(project_id: str, account: str = Depends(actor)):
    require_account(account, {"sales", "software", "pm"})
    if project_id != "RCJM1":
        raise HTTPException(status_code=404, detail="该项目没有配置本机演示来源")
    source = Path(os.environ.get(
        "PRESALES_DEMO_BMS_FILE",
        Path(__file__).resolve().parents[1] / "public/project-data/rcjm1/bms-spec.pdf",
    ))
    if not source.is_file() or source.suffix.lower() != ".pdf":
        raise HTTPException(status_code=404, detail="本机 BMS 原始文件不可用，请手动上传")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    title = "Rack Central · BMS Technical Specification"
    with db() as connection:
        existing = connection.execute(
            "SELECT id, version FROM documents WHERE project_id=? AND title=? AND sha256=? "
            "ORDER BY created_at DESC LIMIT 1",
            (project_id, title, digest),
        ).fetchone()
    if existing:
        return {"id": existing["id"], "version": existing["version"],
                "sha256": digest, "already_imported": True}
    with source.open("rb") as handle:
        uploaded = UploadFile(file=handle, filename=source.name)
        result = await upload_document(
            project_id, title, "SHA-" + digest[:8], uploaded, account,
        )
    return {**result, "already_imported": False}


@app.get("/api/documents/{document_id}/pages/{page}")
def source_page(document_id: str, page: int, account: str = Depends(actor)):
    with db() as connection:
        document = row_or_404(connection, "documents", document_id)
        content = stored_pages(connection, document)
    if page < 1 or page > len(content):
        raise HTTPException(status_code=404, detail="页码不存在")
    return {"document_id": document_id, "version": document["version"],
            "page": page, "text": content[page - 1]}


KEYWORDS = re.compile(r"\b(OPC|BACnet|Modbus|SNMP|alarm|redundan\w*|histor\w*|video|server)\b", re.I)


@app.post("/api/documents/{document_id}/extract")
def extract(document_id: str, force: bool = False, account: str = Depends(actor)):
    require_account(account, {"software", "pm"})
    with db() as connection:
        document = row_or_404(connection, "documents", document_id)
        existing = connection.execute(
            "SELECT * FROM requirements WHERE document_id=? ORDER BY page", (document_id,),
        ).fetchall()
        if existing and not force:
            return {"mode": "mock", "coverage": "keyword_only",
                    "requirements": [dict(row) for row in existing]}
        if existing and force:
            if any(row["status"] != "candidate" for row in existing):
                raise HTTPException(status_code=409, detail="已有人工处理记录，不能覆盖候选；请上传新版本")
            connection.execute(
                "DELETE FROM candidate_sources WHERE requirement_id IN "
                "(SELECT id FROM requirements WHERE document_id=?)", (document_id,),
            )
            connection.execute("DELETE FROM requirements WHERE document_id=?", (document_id,))
            log(connection, document["project_id"], account, "mock_reextracted",
                document_id, f"重新提取未核对候选 {len(existing)} 条")
        found = []
        for page_number, page_text in enumerate(stored_pages(connection, document), 1):
            page_found = 0
            for line in page_text.splitlines():
                quote = " ".join(line.split()).strip()
                if len(quote) < 24 or not KEYWORDS.search(quote):
                    continue
                if any(item["quote"] == quote for item in found):
                    continue
                found.append({"id": str(uuid4()), "project_id": document["project_id"],
                              "document_id": document_id, "page": page_number,
                              "quote": quote[:1000], "text": quote[:1000],
                              "status": "candidate", "revision": 1,
                              "disposition": None, "customer_answer": None,
                              "reviewer": None, "note": None, "updated_at": now()})
                page_found += 1
                if page_found >= 4:
                    break
            if len(found) >= 200:
                break
        for item in found:
            connection.execute(
                "INSERT INTO requirements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                tuple(item.values()),
            )
        log(connection, document["project_id"], account, "mock_extracted", document_id,
            f"关键词候选 {len(found)} 条；不代表全文覆盖")
        return {"mode": "mock", "coverage": "keyword_only", "requirements": found}


class LiveExtraction(BaseModel):
    pages: list[int] = Field(min_length=1, max_length=3)


@app.post("/api/documents/{document_id}/extract-live")
def extract_live(document_id: str, payload: LiveExtraction,
                 account: str = Depends(actor)):
    require_account(account, {"software"})
    if not os.environ.get("MOONSHOT_API_KEY", "").strip():
        raise HTTPException(status_code=503, detail="请先在服务端配置 MOONSHOT_API_KEY")
    selected = sorted(set(payload.pages))
    if len(selected) != len(payload.pages):
        raise HTTPException(status_code=422, detail="页码不能重复")
    with db() as connection:
        document = row_or_404(connection, "documents", document_id)
        source_pages = stored_pages(connection, document)
        if any(page < 1 or page > len(source_pages) for page in selected):
            raise HTTPException(status_code=422, detail="页码超出文件范围")
        placeholders = ",".join("?" for _ in selected)
        prior = connection.execute(
            f"SELECT status FROM requirements WHERE document_id=? AND page IN ({placeholders})",
            (document_id, *selected),
        ).fetchall()
        if any(row["status"] != "candidate" for row in prior):
            raise HTTPException(status_code=409, detail="所选页已有人工处理记录；请上传新版本")
        run_id = str(uuid4())
        connection.execute(
            "INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, document["project_id"], document_id, account, "live",
             model_name(), ",".join(str(page) for page in selected), "running",
             0, 0, None, now(), None),
        )
    candidates = []
    skipped = 0
    try:
        for page in selected:
            original = source_pages[page - 1]
            excerpt = original[:12000]
            for item in extract_requirements(excerpt, page):
                quote, requirement = item.get("quote"), item.get("requirement")
                if (not isinstance(quote, str) or not isinstance(requirement, str)
                        or len(quote.strip()) < 8 or len(quote) > 1000
                        or len(requirement.strip()) < 3 or quote not in excerpt):
                    skipped += 1
                    continue
                if any(row["page"] == page and row["quote"] == quote for row in candidates):
                    continue
                candidates.append({"id": str(uuid4()), "project_id": document["project_id"],
                                   "document_id": document_id, "page": page,
                                   "quote": quote, "text": requirement.strip()[:1000],
                                   "status": "candidate", "revision": 1,
                                   "disposition": None, "customer_answer": None,
                                   "reviewer": None, "note": None, "updated_at": now()})
        with db() as connection:
            latest = connection.execute(
                f"SELECT status FROM requirements WHERE document_id=? AND page IN ({placeholders})",
                (document_id, *selected),
            ).fetchall()
            if any(row["status"] != "candidate" for row in latest):
                raise HTTPException(status_code=409, detail="人工处理已开始；本次候选未覆盖现有记录")
            if candidates:
                connection.execute(
                    "DELETE FROM candidate_sources WHERE requirement_id IN "
                    f"(SELECT id FROM requirements WHERE document_id=? AND page IN ({placeholders}))",
                    (document_id, *selected),
                )
                connection.execute(
                    f"DELETE FROM requirements WHERE document_id=? AND page IN ({placeholders})",
                    (document_id, *selected),
                )
                for item in candidates:
                    connection.execute(
                        "INSERT INTO requirements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        tuple(item.values()),
                    )
                    connection.execute(
                        "INSERT INTO candidate_sources VALUES (?,?)", (item["id"], run_id),
                    )
            connection.execute(
                "UPDATE agent_runs SET status='completed', candidate_count=?, "
                "skipped_count=?, finished_at=? WHERE id=?",
                (len(candidates), skipped, now(), run_id),
            )
            log(connection, document["project_id"], account, "kimi_extracted", run_id,
                f"来源 {document_id}；页 {selected}；原文匹配候选 {len(candidates)} 条；跳过 {skipped} 条")
    except Exception as error:
        detail = error.args[0] if isinstance(error, KimiError) else "提取未完成，原有要求未改变"
        with db() as connection:
            connection.execute(
                "UPDATE agent_runs SET status='failed', error=?, finished_at=? WHERE id=?",
                (detail, now(), run_id),
            )
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(status_code=502, detail=detail) from error
    return {"run_id": run_id, "mode": "live", "model": model_name(),
            "coverage": "selected_pages_only", "pages": selected,
            "candidate_count": len(candidates), "skipped_count": skipped,
            "requirements": candidates}


@app.get("/api/projects/{project_id}/requirements")
def list_requirements(project_id: str, account: str = Depends(actor)):
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT r.*, d.version AS source_version, d.title AS source_title, "
            "CASE WHEN cs.run_id IS NULL THEN 'mock' ELSE 'kimi' END AS extractor, "
            "cs.run_id AS extraction_run_id "
            "FROM requirements r JOIN documents d ON d.id=r.document_id "
            "LEFT JOIN candidate_sources cs ON cs.requirement_id=r.id "
            "WHERE r.project_id=? ORDER BY d.created_at DESC, r.page", (project_id,),
        )]


class Verify(BaseModel):
    expected_revision: int
    requirement: str = Field(min_length=3)
    note: str = Field(min_length=3)


def revision_guard(row, expected: int) -> None:
    if row["revision"] != expected or row["status"] == "stale":
        raise HTTPException(status_code=409, detail="来源或要求版本已变化，请重新核对")


@app.post("/api/requirements/{requirement_id}/verify")
def verify(requirement_id: str, payload: Verify, account: str = Depends(actor)):
    require_account(account, {"software"})
    with db() as connection:
        requirement = row_or_404(connection, "requirements", requirement_id)
        revision_guard(requirement, payload.expected_revision)
        connection.execute(
            "UPDATE requirements SET text=?, status='verified', revision=revision+1, "
            "reviewer=?, note=?, disposition=NULL, customer_answer=NULL, updated_at=? WHERE id=?",
            (payload.requirement.strip(), account, payload.note.strip(), now(), requirement_id),
        )
        connection.execute("UPDATE facts SET active=0 WHERE requirement_id=?", (requirement_id,))
        log(connection, requirement["project_id"], account, "source_verified",
            requirement_id, payload.note.strip())
        return dict(row_or_404(connection, "requirements", requirement_id))


class HandoffRequest(BaseModel):
    owner: str
    question: str = Field(min_length=3)


@app.post("/api/requirements/{requirement_id}/handoffs")
def create_handoff(requirement_id: str, payload: HandoffRequest,
                   account: str = Depends(actor)):
    require_account(account, {"software"})
    if payload.owner not in {"sales", "dev", "solution"}:
        raise HTTPException(status_code=422, detail="接收岗位不支持")
    with db() as connection:
        requirement = row_or_404(connection, "requirements", requirement_id)
        if requirement["status"] not in {"verified", "rejected"}:
            raise HTTPException(status_code=409, detail="请先核对原文要求")
        identifier = str(uuid4())
        connection.execute(
            "INSERT INTO handoffs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (identifier, requirement["project_id"], requirement_id,
             account, payload.owner, payload.question.strip(), None,
             "pending", 0, now(), None),
        )
        log(connection, requirement["project_id"], account, "handoff_created",
            identifier, payload.question.strip())
        return {"id": identifier, "owner": payload.owner, "status": "pending"}


@app.get("/api/inbox")
def inbox(account: str = Depends(actor)):
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM handoffs WHERE owner=? ORDER BY created_at DESC", (account,),
        )]


@app.get("/api/projects/{project_id}/handoffs")
def project_handoffs(project_id: str, account: str = Depends(actor)):
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM handoffs WHERE project_id=? ORDER BY created_at DESC",
            (project_id,),
        )]


class Reply(BaseModel):
    answer: str = Field(min_length=3)


@app.post("/api/handoffs/{handoff_id}/reply")
def reply(handoff_id: str, payload: Reply, account: str = Depends(actor)):
    with db() as connection:
        handoff = row_or_404(connection, "handoffs", handoff_id)
        if handoff["owner"] != account:
            raise HTTPException(status_code=403, detail="仅接收岗位可答复")
        if handoff["status"] != "pending" or handoff["outdated"]:
            raise HTTPException(status_code=409, detail="交接已处理或来源失效")
        connection.execute(
            "UPDATE handoffs SET answer=?, status='answered', answered_at=? WHERE id=?",
            (payload.answer.strip(), now(), handoff_id),
        )
        log(connection, handoff["project_id"], account, "handoff_answered",
            handoff_id, payload.answer.strip())
        return {"id": handoff_id, "status": "answered"}


class Decision(BaseModel):
    expected_revision: int
    action: str
    disposition: str = ""
    customer_answer: str = ""
    note: str = Field(min_length=3)


@app.post("/api/requirements/{requirement_id}/decision")
def decide(requirement_id: str, payload: Decision, account: str = Depends(actor)):
    require_account(account, {"software"})
    if payload.action not in {"approve", "reject"}:
        raise HTTPException(status_code=422, detail="只支持批准或驳回")
    with db() as connection:
        requirement = row_or_404(connection, "requirements", requirement_id)
        revision_guard(requirement, payload.expected_revision)
        if requirement["status"] not in {"verified", "rejected"}:
            raise HTTPException(status_code=409, detail="请先核对原文要求")
        handoffs = connection.execute(
            "SELECT * FROM handoffs WHERE requirement_id=? AND outdated=0",
            (requirement_id,),
        ).fetchall()
        if payload.action == "approve":
            if not payload.customer_answer.strip() or not payload.disposition.strip():
                raise HTTPException(status_code=422, detail="缺少客户应答或判定")
            if any(item["status"] != "answered" for item in handoffs):
                raise HTTPException(status_code=409, detail="关联岗位尚未答复")
            if "video" in requirement["quote"].lower() and not (
                {item["owner"] for item in handoffs} >= {"sales", "dev"}
            ):
                raise HTTPException(status_code=409, detail="视频范围须先取得销售澄清和研发意见")
        status = "approved" if payload.action == "approve" else "rejected"
        connection.execute(
            "UPDATE requirements SET status=?, disposition=?, customer_answer=?, "
            "reviewer=?, note=?, revision=revision+1, updated_at=? WHERE id=?",
            (status, payload.disposition.strip() or None,
             payload.customer_answer.strip() or None, account, payload.note.strip(),
             now(), requirement_id),
        )
        connection.execute("UPDATE facts SET active=0 WHERE requirement_id=?", (requirement_id,))
        log(connection, requirement["project_id"], account, payload.action,
            requirement_id, payload.note.strip())
        return dict(row_or_404(connection, "requirements", requirement_id))


class Publish(BaseModel):
    expected_revision: int


@app.post("/api/requirements/{requirement_id}/publish")
def publish(requirement_id: str, payload: Publish, account: str = Depends(actor)):
    require_account(account, {"software"})
    with db() as connection:
        requirement = row_or_404(connection, "requirements", requirement_id)
        revision_guard(requirement, payload.expected_revision)
        if requirement["status"] != "approved":
            raise HTTPException(status_code=409, detail="客户版内容尚未由软件产品复核")
        identifier = str(uuid4())
        connection.execute(
            "INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?)",
            (identifier, requirement_id, requirement["revision"],
             requirement["document_id"], requirement["customer_answer"],
             requirement["disposition"], account, now(), 1),
        )
        connection.execute(
            "UPDATE requirements SET status='published', updated_at=? WHERE id=?",
            (now(), requirement_id),
        )
        log(connection, requirement["project_id"], account, "fact_published",
            identifier, f"要求 {requirement_id}；来源修订 {requirement['revision']}")
        return {"id": identifier, "requirement_id": requirement_id,
                "revision": requirement["revision"], "active": True}


@app.get("/api/projects/{project_id}/events")
def events(project_id: str, account: str = Depends(actor)):
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM audit WHERE project_id=? ORDER BY created_at DESC",
            (project_id,),
        )]


@app.get("/api/projects/{project_id}/facts")
def facts(project_id: str, account: str = Depends(actor)):
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT f.*, r.quote, d.title AS source_title, d.version AS source_version "
            "FROM facts f JOIN requirements r ON r.id=f.requirement_id "
            "JOIN documents d ON d.id=f.document_id "
            "WHERE r.project_id=? AND f.active=1 ORDER BY f.published_at DESC",
            (project_id,),
        )]


@app.get("/api/projects/{project_id}/progress")
def project_progress(project_id: str, account: str = Depends(actor)):
    """Authoritative progress for the service-backed F5 review slice."""
    with db() as connection:
        documents = connection.execute(
            "SELECT id, title, version, created_at FROM documents WHERE project_id=? "
            "ORDER BY created_at DESC, rowid DESC", (project_id,),
        ).fetchall()
        latest_by_title = {}
        for document in documents:
            latest_by_title.setdefault(document["title"], document)
        latest_ids = [row["id"] for row in latest_by_title.values()]
        counts = {status: 0 for status in
                  ("candidate", "verified", "rejected", "approved", "published", "stale")}
        pending_handoffs = 0
        if latest_ids:
            placeholders = ",".join("?" for _ in latest_ids)
            for row in connection.execute(
                f"SELECT status, COUNT(*) AS count FROM requirements "
                f"WHERE document_id IN ({placeholders}) GROUP BY status", latest_ids,
            ):
                counts[row["status"]] = row["count"]
            pending_handoffs = connection.execute(
                "SELECT COUNT(*) FROM handoffs h JOIN requirements r ON r.id=h.requirement_id "
                f"WHERE r.document_id IN ({placeholders}) AND h.status='pending' "
                "AND h.outdated=0", latest_ids,
            ).fetchone()[0]
        stale = connection.execute(
            "SELECT COUNT(*) FROM requirements WHERE project_id=? AND status='stale'",
            (project_id,),
        ).fetchone()[0]
        run = connection.execute(
            "SELECT id, model, pages, status, candidate_count, skipped_count, "
            "error, started_at, finished_at FROM agent_runs WHERE project_id=? "
            "ORDER BY started_at DESC, rowid DESC LIMIT 1", (project_id,),
        ).fetchone()
    if not documents:
        label, next_action = "待来源文件", "上传有版本的规格书或软件需求文件"
    elif run and run["status"] == "running":
        label, next_action = "Agent 提取中", "等待选定页提取结束"
    elif counts["candidate"]:
        label, next_action = "待核对原文", f"软件产品核对 {counts['candidate']} 条候选与原文"
    elif pending_handoffs:
        label, next_action = "待岗位答复", f"接收岗位处理 {pending_handoffs} 个问题"
    elif counts["verified"] or counts["rejected"]:
        label, next_action = "待专业判断", "软件产品复核答复、澄清和客户应答"
    elif counts["approved"]:
        label, next_action = "待写回", f"软件产品写回 {counts['approved']} 条已批准应答"
    elif counts["published"]:
        label, next_action = "已写回", "按新版本变化复核受影响要求"
    else:
        label, next_action = "待提取", "选择来源文件及页码，执行 Kimi 或关键词提取"
    return {"project_id": project_id, "stage": "F5", "status": label,
            "next_action": next_action, "document_count": len(documents),
            "latest_sources": [{"title": row["title"], "version": row["version"]}
                               for row in latest_by_title.values()],
            "counts": counts, "pending_handoffs": pending_handoffs,
            "stale_count": stale, "last_run": dict(run) if run else None,
            "scope": "F5 service-backed source review"}


@app.get("/api/tasks")
def tasks(account: str = Depends(actor)):
    result = []
    with db() as connection:
        if account in {"sales", "dev", "solution"}:
            for row in connection.execute(
                "SELECT h.*, r.quote, d.version AS source_version "
                "FROM handoffs h JOIN requirements r ON r.id=h.requirement_id "
                "JOIN documents d ON d.id=r.document_id "
                "WHERE h.owner=? AND h.status='pending' AND h.outdated=0 "
                "ORDER BY h.created_at DESC", (account,),
            ):
                result.append({"id": row["id"], "project_id": row["project_id"],
                               "requirement_id": row["requirement_id"],
                               "title": row["question"], "status": "待答复",
                               "owner": row["sender"] + " → " + row["owner"],
                               "source_version": row["source_version"]})
        if account == "software":
            labels = {"candidate": "待核对", "verified": "待专业判断",
                      "rejected": "待重审", "approved": "待写回", "stale": "版本失效"}
            for row in connection.execute(
                "SELECT r.project_id, r.status, d.id AS document_id, d.title, d.version, "
                "COUNT(*) AS total FROM requirements r JOIN documents d ON d.id=r.document_id "
                "WHERE r.status IN ('candidate','verified','rejected','approved','stale') "
                "GROUP BY r.project_id, r.status, d.id ORDER BY r.project_id, d.created_at DESC, r.status"
            ):
                display_version = "本机原件" if row["version"].startswith("SHA-") else row["version"]
                result.append({"id": row["document_id"] + ":" + row["status"],
                               "project_id": row["project_id"],
                               "title": f"{row['title']} · {display_version} · {row['total']} 条要求",
                               "status": labels[row["status"]],
                               "owner": "软件产品", "count": row["total"]})
            for row in connection.execute(
                "SELECT h.id, h.project_id, h.requirement_id, h.owner, h.question "
                "FROM handoffs h JOIN requirements r ON r.id=h.requirement_id "
                "WHERE h.status='answered' AND h.outdated=0 "
                "AND r.status IN ('verified','rejected') ORDER BY h.answered_at DESC"
            ):
                result.append({"id": row["id"], "project_id": row["project_id"],
                               "requirement_id": row["requirement_id"],
                               "title": row["question"], "status": "待处理答复",
                               "owner": row["owner"] + " → 软件产品"})
    return result
