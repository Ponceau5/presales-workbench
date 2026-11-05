"""Private, source-bound conversation facts and paged originals; no model-written facts."""
import json,re
from functools import lru_cache

@lru_cache(maxsize=1)
def tokenizer():
 import tiktoken
 return tiktoken.get_encoding('cl100k_base')

def token_count(text):
 try:return len(tokenizer().encode(str(text),disallowed_special=()))
 except Exception:return len(str(text).encode('utf-8'))  # conservative byte-token upper bound

def trim_tokens(text,budget):
 text=str(text)
 try:return tokenizer().decode(tokenizer().encode(text,disallowed_special=())[:max(0,budget)])
 except Exception:
  while token_count(text)>budget:text=text[:max(0,len(text)*3//4)]
  return text

def initialize(db):
 with db() as c:c.executescript('''
 CREATE TABLE IF NOT EXISTS conversation_messages(project_id TEXT,workspace_id TEXT,actor TEXT,conversation_id TEXT,turn_id TEXT,position INTEGER,value TEXT,PRIMARY KEY(project_id,workspace_id,actor,conversation_id,turn_id));
 CREATE TABLE IF NOT EXISTS conversation_memory(project_id TEXT,workspace_id TEXT,actor TEXT,conversation_id TEXT,rolling_summary TEXT,facts TEXT,token_estimate INTEGER,updated_at TEXT,PRIMARY KEY(project_id,workspace_id,actor,conversation_id));
 ''')

def save_turns(c,project,stage,actor,conversation,turns,now):
 scope=(project,stage,actor,conversation)
 deleted=c.execute('SELECT value FROM workspace_dialogues WHERE project_id=? AND stage_id=? AND actor=? AND id=?',scope).fetchone()
 if deleted and json.loads(deleted[0]).get('deleted'):return
 for position,t in enumerate(turns):
  if not isinstance(t,dict) or not t.get('id'):continue
  c.execute('INSERT INTO conversation_messages VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id,workspace_id,actor,conversation_id,turn_id) DO UPDATE SET value=excluded.value',(*scope,t['id'],position,json.dumps(t,ensure_ascii=False)))
 originals=[json.loads(r[0]) for r in c.execute('SELECT value FROM conversation_messages WHERE project_id=? AND workspace_id=? AND actor=? AND conversation_id=? ORDER BY position,rowid',scope)]
 prior=c.execute('SELECT facts FROM conversation_memory WHERE project_id=? AND workspace_id=? AND actor=? AND conversation_id=?',scope).fetchone()
 facts=json.loads(prior[0]) if prior else []
 # Original user statements, never assistant guesses. Keep immutable provenance and versions.
 known={f['turn_id'] for f in facts}
 for turn in originals:
  q=turn.get('question','')
  if turn['id'] in known or not re.search(r'客户|确认|条件|必须|不得|版本|负责|待确认|待补|V\d+',q,re.I):continue
  refs=[]
  request=c.execute('SELECT sources FROM execution_inputs WHERE id=? AND project_id=? AND stage_id=? AND actor=?',(turn['id'],project,stage,actor)).fetchone()
  for src in json.loads(request[0]) if request else []:
   if src.get('id') and src.get('version') and (str(src.get('title','!')) in q or str(src['version']) in q):refs.append({'id':src['id'],'version':src['version']})
  kind='open_questions' if re.search(r'待确认|待补|尚未',q) else 'role_assignments' if '负责' in q else 'confirmed_facts' if '确认' in q else 'customer_conditions'
  facts.append({'turn_id':turn['id'],'kind':kind,'text':q,'source_versions':refs,'valid':True,'basis':'用户原话'})
 for fact in facts:
  if not fact['source_versions']:
   fact['source_versions']=[{'id':d['id'],'version':d['version']} for d in c.execute('SELECT id,title,version FROM documents WHERE project_id=?',(project,)) if d['title'] in fact['text'] and d['version'] in fact['text']]
  for ref in fact['source_versions']:
   doc=c.execute("SELECT d.version,COALESCE(r.category,'input') category FROM documents d LEFT JOIN document_registry r ON r.document_id=d.id WHERE d.id=? AND d.project_id=?",(ref['id'],project)).fetchone()
   if not doc or doc['version']!=ref['version'] or doc['category'] in {'disabled','temporary'}:fact['valid']=False
 summary=trim_tokens('\n'.join('问题：'+t.get('question','')+'\n进展：'+t.get('answer','') for t in originals[-3:] if t.get('status') in {'done','notice'}),800)
 data=json.dumps(facts,ensure_ascii=False)
 c.execute('INSERT INTO conversation_memory VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,workspace_id,actor,conversation_id) DO UPDATE SET rolling_summary=excluded.rolling_summary,facts=excluded.facts,token_estimate=excluded.token_estimate,updated_at=excluded.updated_at',(*scope,summary,data,token_count(summary+data),now))

def context(db,project,stage,actor,conversation):
 scope=(project,stage,actor,conversation)
 with db() as c:
  rows=[json.loads(r[0]) for r in c.execute('SELECT value FROM conversation_messages WHERE project_id=? AND workspace_id=? AND actor=? AND conversation_id=? ORDER BY position,rowid',scope)]
  if rows:
   from datetime import datetime,timezone
   save_turns(c,*scope,[],datetime.now(timezone.utc).isoformat())
  row=c.execute('SELECT * FROM conversation_memory WHERE project_id=? AND workspace_id=? AND actor=? AND conversation_id=?',scope).fetchone()
  artifacts=[r[0] for r in c.execute('SELECT id FROM workspace_artifacts WHERE project_id=? AND stage_id=? AND adopted_by=? AND conversation_id=?',scope)]
 if not row:return {'facts':[],'artifact_ids':artifacts,'retention':'未收藏对话结束即删除；收藏随项目保留'}
 facts=json.loads(row['facts']);active=[f for f in facts if f['valid']]
 # Reserve facts before recent discussion; originals remain accessible through history reader.
 selected=[];used=0
 for fact in reversed(active):
  size=token_count(json.dumps(fact,ensure_ascii=False))
  if used+size>3000:continue
  selected.append(fact);used+=size
 return {'facts':selected,'rolling_summary':row['rolling_summary'],'invalidated_facts':[{**f,'text':trim_tokens(f['text'],100)} for f in facts if not f['valid']][-10:], 'artifact_ids':artifacts,'token_estimate':used+token_count(row['rolling_summary']),'facts_available':len(active),'original_history_available':True}

def erase(c,project,stage,actor,conversation):
 for table in ('conversation_messages','conversation_memory'):
  c.execute(f'DELETE FROM {table} WHERE project_id=? AND workspace_id=? AND actor=? AND conversation_id=?',(project,stage,actor,conversation))
