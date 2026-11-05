"""Read-only administrator execution viewer, served separately on loopback:7102."""
import json
import os
from pathlib import Path

import httpx
from fastapi import Cookie, Depends, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse

from database import connect

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
ROOT = Path(__file__).parent
DB_PATH = Path(os.getenv('PRESALES_DATA_DIR', ROOT / '.local')) / 'workbench.sqlite3'


async def administrator(presales_source_session: str = Cookie(default='')):
    if not presales_source_session:
        raise HTTPException(401, '请先在工作台登录管理员账号')
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
            reply = await client.get('http://127.0.0.1:8000/api/me',
                                     headers={'Authorization': 'Bearer ' + presales_source_session})
    except httpx.HTTPError:
        raise HTTPException(503, '工作台后台未连接，请启动 8000 服务') from None
    if reply.status_code != 200:
        raise HTTPException(401, '登录已过期，请在工作台重新登录')
    if not reply.json().get('is_admin'):
        raise HTTPException(403, '仅管理员可以查看运行日志')


@app.middleware('http')
async def headers(request, call_next):
    result = await call_next(request)
    result.headers['Cache-Control'] = 'no-store'
    result.headers['X-Content-Type-Options'] = 'nosniff'
    result.headers['X-Frame-Options'] = 'DENY'
    result.headers['Referrer-Policy'] = 'no-referrer'
    return result


@app.get('/', response_class=HTMLResponse)
def page():
    return (ROOT / 'log_viewer.html').read_text()


def diagnosis(details, reason):
    for item in reversed(details if isinstance(details, list) else []):
        if isinstance(item, dict) and item.get('metric') == 'provider_error':
            status = item.get('http_status')
            messages = {402: '模型 API 账户余额不足，请检查供应商账户并充值',
                        401: '模型 API 认证失败，请检查密钥配置',
                        429: '模型供应商限流，请稍后重试并检查供应商额度',
                        503: '模型供应商暂时不可用，请稍后重试'}
            return messages.get(status, reason), status
    return reason, None


@app.get('/api/logs', dependencies=[Depends(administrator)])
def logs(project: str = Query('', max_length=100), actor: str = Query('', max_length=100),
         status: str = Query('', max_length=30), page: int = Query(1, ge=1, le=100000)):
    clauses, args = [], []
    for column, value in [('project_id', project), ('actor', actor), ('status', status)]:
        if value:
            clauses.append(column + '=?')
            args.append(value)
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    with connect(DB_PATH) as c:
        total = c.execute('SELECT count(*) FROM execution_metrics' + where, args).fetchone()[0]
        rows = c.execute('SELECT * FROM execution_metrics' + where +
                         ' ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?', args + [(page - 1) * 30]).fetchall()
    result = []
    for raw in rows:
        row = dict(raw)
        try:
            details = json.loads(row['details'])
        except (ValueError, TypeError):
            details = []
        row['diagnosis'], row['http_status'] = diagnosis(details, row['reason'])
        # Explicit allowlist: never expose prompts, document text, credentials or raw provider bodies.
        row['details'] = [{k: v for k, v in item.items() if k in
                          {'metric', 'seconds', 'http_status', 'code', 'name', 'status', 'count', 'reason',
                           'elapsed_seconds', 'first_text_seconds', 'model_calls', 'usage'}}
                         for item in details if isinstance(item, dict)] if isinstance(details, list) else []
        result.append(row)
    return {'rows': result, 'total': total, 'page': page, 'page_size': 30}
