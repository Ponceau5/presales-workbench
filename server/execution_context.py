"""Bound prompt size while keeping full private history available through an authorized tool."""
import json,re

def compact_history(raw,budget=2000):
 from conversation_memory import token_count,trim_tokens
 if token_count(raw)<=budget:return raw
 try:value=json.loads(raw)
 except (ValueError,TypeError):return json.dumps({'excerpt':trim_tokens(raw,budget-100),'truncated':True},ensure_ascii=False)
 turns=value.get('turns',[]) if isinstance(value,dict) else []
 result={'turns':[],'truncated':True,'history_available_by_tool':True}
 for turn in reversed(turns):
  if not isinstance(turn,dict):continue
  item={k:trim_tokens(turn.get(k,''),500) for k in ('id','question','answer')}
  candidate={**result,'turns':[item,*result['turns']]}
  if token_count(json.dumps(candidate,ensure_ascii=False))>budget:break
  result=candidate
 return json.dumps(result,ensure_ascii=False)

def source_excerpts(sources,budget=10000):
 """Only the model prompt is shortened; authoritative snapshots are untouched."""
 result=[];remaining=budget
 for source in sources:
  row={k:v for k,v in source.items() if k not in {'text','scenario','workflow','tools'}}
  text=source.get('text','')
  if text:
   limit=min(1600,remaining);row['text']=text[:limit];row['excerpt_only']=len(text)>limit;remaining-=len(row['text'])
  result.append(row)
 return result

def history_reader(db,project,stage,user,conversation,fallback=''):
 with db() as c:
  originals=c.execute('SELECT value FROM conversation_messages WHERE project_id=? AND workspace_id=? AND actor=? AND conversation_id=? ORDER BY position,rowid',(project,stage,user,conversation)).fetchall() if c.execute("SELECT 1 FROM sqlite_master WHERE name='conversation_messages'").fetchone() else []
  row=c.execute('SELECT value FROM workspace_dialogues WHERE project_id=? AND stage_id=? AND actor=? AND id=?',(project,stage,user,conversation)).fetchone()
 try:value=json.loads(row['value'] if row else fallback or '{}')
 except (ValueError,TypeError):value={}
 turns=[json.loads(r[0]) for r in originals] if originals else value.get('turns',[]) if isinstance(value,dict) else []
 frozen=[{k:t.get(k,'') for k in ('id','question','answer')} for t in turns if isinstance(t,dict) and t.get('status','done') in {'done','notice'}]
 def read(query='',turn_id=''):
  rows=[t for t in frozen if (not turn_id or t['id']==turn_id) and (not query or query.casefold() in (t['question']+' '+t['answer']).casefold())]
  if not query and not turn_id:rows=rows[-4:]
  result=[];remaining=8000
  for t in rows[:8]:
   q=str(t['question'])[:1000];answer=str(t['answer'])[:max(0,min(5000,remaining-len(q)))];remaining-=len(q)+len(answer)
   result.append({'id':t['id'],'question':q,'answer':answer,'excerpt_only':len(answer)<len(str(t['answer']))})
   if remaining<=0:break
  return {'matches':len(rows),'turns':result,'scope':'仅当前账号、当前项目、当前工作区、当前对话'}
 return read
