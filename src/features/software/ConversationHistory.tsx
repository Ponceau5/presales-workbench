import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {localApi} from '@/lib/localApi';
import {MarkdownReply} from './MarkdownReply';
import './conversation-history.css';

type HistoryPage={turns:{id:string;question:string;answer:string}[];total:number;offset:number;limit:number};
type Fact={turn_id:string;kind:string;text:string;source_versions:{id:string;version:string}[]};
type Facts={facts:Fact[];invalidated_facts?:Fact[]};
type Props={base:string;conversation:string};
const labels:Record<string,string>={confirmed_facts:'已确认事项',customer_conditions:'客户条件',role_assignments:'责任分工',open_questions:'待确认'};

export function ConversationHistory(props:Props){
 return <HistoryContent key={props.base+':'+props.conversation} {...props}/>;
}

function HistoryContent({base,conversation}:Props){
 const [offset,setOffset]=useState(0),[page,setPage]=useState<HistoryPage|null>(null);
 const [view,setView]=useState<'history'|'facts'>('history');
 const [facts,setFacts]=useState<Facts|null>(null);
 const endpoint=base+'/dialogues/'+encodeURIComponent(conversation);
 useEffect(()=>{
  const controller=new AbortController();
  void localApi<HistoryPage>(endpoint+'/history?offset='+offset+'&limit=10',{signal:controller.signal}).then(setPage).catch(e=>{if(!controller.signal.aborted)toast.error(e instanceof Error?e.message:'历史记录读取失败');});
  return()=>controller.abort();
 },[endpoint,offset]);
 useEffect(()=>{
  if(view!=='facts')return;
  const controller=new AbortController();
  void localApi<Facts>(endpoint+'/facts',{signal:controller.signal}).then(setFacts).catch(e=>{if(!controller.signal.aborted)toast.error(e instanceof Error?e.message:'业务事实读取失败');});
  return()=>controller.abort();
 },[endpoint,view]);
 function factRows(rows:Fact[]){
  return rows.map(fact=><article className="conversation-fact" key={fact.turn_id}>
   <h4>{labels[fact.kind]||'业务条件'}</h4><p>{fact.text}</p>
   <dl><div><dt>原始对话</dt><dd>{fact.turn_id}</dd></div>
    {!!fact.source_versions.length&&<div><dt>资料版本</dt><dd>{fact.source_versions.map(source=>source.version).join('、')}</dd></div>}
   </dl>
  </article>);
 }
 return <section className="conversation-history">
  <nav className="conversation-history-views" aria-label="对话记录视图">
   <button className="btn" aria-pressed={view==='history'} onClick={()=>setView('history')}>原始对话</button>
   <button className="btn" aria-pressed={view==='facts'} onClick={()=>setView('facts')}>业务事实</button>
  </nav>
  {view==='history'?<>
   <div aria-live="polite">{page?.turns.map(turn=><article className="conversation-original" key={turn.id}><p>{turn.question}</p><MarkdownReply text={turn.answer}/></article>)}{page?.total===0&&<p>暂无历史记录</p>}</div>
   <div className="gsa-actions"><button className="btn" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-10))}>上一页</button><span>{page?Math.min(offset+1,page.total)+'–'+Math.min(offset+10,page.total)+' / '+page.total:'读取中'}</span><button className="btn" disabled={!page||offset+10>=page.total} onClick={()=>setOffset(offset+10)}>下一页</button></div>
  </>:<div aria-live="polite">{facts?<> {factRows(facts.facts)}{!facts.facts.length&&<p>暂无业务事实</p>}{!!facts.invalidated_facts?.length&&<details><summary>已失效的依据</summary>{factRows(facts.invalidated_facts)}</details>}</>:<p role="status">读取中…</p>}</div>}
 </section>;
}
