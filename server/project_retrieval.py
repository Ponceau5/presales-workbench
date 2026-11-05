"""Version-bound project retrieval. Only registered shared documents are indexed."""
import re
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field


def initialize(db):
    with db() as c:
        if getattr(c,'dialect','sqlite')=='postgresql':
            c.execute('CREATE EXTENSION IF NOT EXISTS vector')
            c.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
            c.execute("""CREATE TABLE IF NOT EXISTS material_vectors(
                document_id TEXT NOT NULL,version TEXT NOT NULL,page INTEGER NOT NULL,paragraph INTEGER NOT NULL,
                project_id TEXT NOT NULL,workspace_id TEXT NOT NULL DEFAULT '*',permission_scope TEXT NOT NULL DEFAULT 'project',
                content TEXT NOT NULL,embedding vector,embedding_model TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',
                PRIMARY KEY(document_id,version,page,paragraph))""")
            c.execute('CREATE INDEX IF NOT EXISTS ix_vectors_scope ON material_vectors(project_id,workspace_id,document_id,version,status)')
        c.execute("CREATE TABLE IF NOT EXISTS material_indexes(document_id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '')")
        c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS material_chunks USING fts5(document_id UNINDEXED,version UNINDEXED,page UNINDEXED,paragraph UNINDEXED,text, tokenize='trigram')")
        if getattr(c,'dialect','sqlite')=='postgresql':
            c.execute('CREATE INDEX IF NOT EXISTS ix_chunks_document_version ON material_chunks(document_id,version)')
            c.execute('CREATE INDEX IF NOT EXISTS ix_chunks_keyword ON material_chunks USING gin(text gin_trgm_ops)')


def index_document(db, identifier):
    try:
        with db() as c:
            doc=c.execute('SELECT d.*,r.category FROM documents d LEFT JOIN document_registry r ON r.document_id=d.id WHERE d.id=?',(identifier,)).fetchone()
            if not doc: raise ValueError('资料不存在')
            c.execute('DELETE FROM material_chunks WHERE document_id=?',(identifier,))
            texts=c.execute('SELECT page,text FROM document_pages WHERE document_id=? ORDER BY page',(identifier,)).fetchall()
            status='disabled' if doc['category'] in {'disabled','temporary'} else 'ready' if any(p['text'].strip() for p in texts) else 'unparsed'
            chunks=[]
            if status=='ready':
                for page in texts:
                    for paragraph,start in enumerate(range(0,len(page['text']),1200),1):
                        text=page['text'][start:start+1400]
                        if text.strip():chunks.append((identifier,doc['version'],page['page'],paragraph,text))
            postgres=getattr(c,'dialect','sqlite')=='postgresql'
            if chunks and postgres:
                # Native COPY avoids one network round trip for every text block.
                with c.raw.cursor().copy('COPY material_chunks (document_id,version,page,paragraph,text) FROM STDIN') as copy:
                    for chunk in chunks:copy.write_row(chunk)
            elif chunks:
                c.executemany('INSERT INTO material_chunks VALUES (?,?,?,?,?)',chunks)
            if postgres:
                c.execute('DELETE FROM material_vectors WHERE document_id=?',(identifier,))
                if status=='ready':
                    c.execute("""INSERT INTO material_vectors(document_id,version,page,paragraph,project_id,content)
                        SELECT ch.document_id,ch.version,ch.page,ch.paragraph,d.project_id,ch.text
                        FROM material_chunks ch JOIN documents d ON d.id=ch.document_id WHERE d.id=?""",(identifier,))
            c.execute('INSERT OR REPLACE INTO material_indexes VALUES (?,?,?,?)',(identifier,doc['version'],status,''))
        return status
    except Exception:
        with db() as c:
            doc=c.execute('SELECT version FROM documents WHERE id=?',(identifier,)).fetchone()
            if doc:c.execute('INSERT OR REPLACE INTO material_indexes VALUES (?,?,?,?)',(identifier,doc['version'],'failed','索引生成失败，可重试；原件仍保留'))
        return 'failed'


SYNONYMS=(('BMS','楼控','楼宇自控','楼宇控制'),('EPMS','电力监控','电力管理'),('点表','IO清单','IO 清单','点位表'),('BOQ','工程量清单','报价清单'),('SOO','控制序列','控制要求'))

def query_terms(query):
    cleaned=query
    for stop in ('请帮我','请查找','请查询','请找','查询','查找','本项目','相关资料','的'):
        cleaned=cleaned.replace(stop,' ')
    expanded=[]
    for group in SYNONYMS:
        matched=False
        for alias in sorted(group,key=len,reverse=True):
            pattern=r'(?<![a-z0-9])'+re.escape(alias)+r'(?![a-z0-9])' if alias.isascii() else re.escape(alias)
            if re.search(pattern,query,re.IGNORECASE):
                matched=True
                cleaned=re.sub(pattern,' ',cleaned,flags=re.IGNORECASE)
        if matched:expanded.extend(group)
    # Keep recognized phrases whole: "IO 清单" must not become the generic "清单".
    terms=re.findall(r'[a-zA-Z0-9_-]+|[\u4e00-\u9fff]+',cleaned)+expanded
    return list(dict.fromkeys(t.strip() for t in terms if t.strip()))[:30]


def search(db, project, query, identifiers=None,stage=None):
    with db() as c:
        docs=[dict(d) for d in c.execute("SELECT d.id,d.title,d.version,d.created_at,i.status,COALESCE(r.category,'input') category FROM documents d LEFT JOIN material_indexes i ON i.document_id=d.id AND i.version=d.version LEFT JOIN document_registry r ON r.document_id=d.id WHERE d.project_id=? AND COALESCE(r.category,'input') NOT IN ('disabled','temporary')",(project,))]
        if identifiers is not None:docs=[d for d in docs if d['id'] in identifiers]
        if stage and c.execute("SELECT 1 FROM sqlite_master WHERE name='workspace_material_tags'").fetchone():
            tags={}
            for tag in c.execute('SELECT document_id,stage_id FROM workspace_material_tags'):tags.setdefault(tag['document_id'],set()).add(tag['stage_id'])
            docs=[d for d in docs if not tags.get(d['id']) or '*' in tags[d['id']] or stage in tags[d['id']]]
        ids={d['id']:d for d in docs if d['status']=='ready'}; hits=[]
        terms=query_terms(query)
        if terms and ids:
            # LIKE is intentional for short Chinese tokens unsupported by trigram MATCH.
            operator='ILIKE' if getattr(c,'dialect','sqlite')=='postgresql' else 'LIKE'
            clauses=' OR '.join(f'ch.text {operator} ? ESCAPE \'\\\'' for _ in terms)
            args=['%'+t.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%' for t in terms]
            rows=c.execute("SELECT ch.* FROM material_chunks ch JOIN documents d ON d.id=ch.document_id AND d.version=ch.version LEFT JOIN document_registry r ON r.document_id=d.id WHERE d.project_id=? AND COALESCE(r.category,'input') NOT IN ('disabled','temporary') AND d.id IN ("+','.join('?' for _ in ids)+") AND ("+clauses+") LIMIT 200",[project,*ids,*args]).fetchall()
            for row in rows:
                if row['document_id'] in ids:
                    hits.append({**dict(row),'title':ids[row['document_id']]['title'],'category':ids[row['document_id']]['category'],'score':(2 if ids[row['document_id']]['category']=='input' else 0)+sum(min(5,row['text'].casefold().count(t.casefold()))+6*int(t.casefold() in ids[row['document_id']]['title'].casefold()) for t in terms)})
        hits.sort(key=lambda h:(h['score'],ids[h['document_id']]['created_at']),reverse=True)
        pending=[d for d in docs if d['status']!='ready']
        status='matched' if hits else 'unparsed' if pending and all(d['status']=='unparsed' for d in pending) else 'index_not_ready' if pending else 'no_match'
        messages={
            'matched':'命中只是资料依据，冲突数值须按各版本原文核对，不得擅自合并。',
            'unparsed':'已就绪资料中无命中，另有资料尚未解析正文。可查看原件或重新解析。',
            'index_not_ready':'部分资料索引未就绪，可重试索引。',
            'no_match':'已就绪资料中没有检索命中，不代表文件不存在。',
        }
        return {'status':status,'hits':hits[:12],'unavailable':pending,'message':messages[status]}


class Search(BaseModel):
    query: str=Field(min_length=1,max_length=500)
    workspace_id: str|None=Field(default=None,pattern=r'^F(?:[1-9]|1[0-3])$')


def install(app,db,actor):
    initialize(db)
    @app.post('/api/projects/{project_id}/materials/search')
    def retrieve(project_id:str,payload:Search,user:str=Depends(actor)):
        from access_control import check_project
        check_project(user,project_id)
        return search(db,project_id,payload.query,stage=payload.workspace_id)
    @app.post('/api/documents/{identifier}/index/retry')
    def retry(identifier:str,user:str=Depends(actor)):
        from access_control import check_project
        with db() as c:doc=c.execute('SELECT * FROM documents WHERE id=?',(identifier,)).fetchone()
        if not doc: raise HTTPException(404,'资料不存在')
        check_project(user,doc['project_id'])
        return {'document_id':identifier,'status':index_document(db,identifier)}
