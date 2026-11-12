import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUp,MessageCircle,Plus,Square,X} from 'lucide-react';
import {toast} from 'sonner';
import {randomId} from '@/lib/id';
import {localApi,downloadApiFile} from '@/lib/localApi';
import {MarkdownReply} from '@/features/software/MarkdownReply';
import {useWorkbench} from '@/state/workbench';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Source={id:string;title:string;version:string;page:number;excerpt:string;download_url:string};
type Message={id:string;role:'user'|'assistant';text:string;sources?:Source[]};
export function ProjectAssistant(){
 const {state}=useWorkbench();
 const [open,setOpen]=useState(false),[input,setInput]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false);
 const pending=useRef<AbortController|null>(null),end=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
 const reset=useCallback(()=>{pending.current?.abort();pending.current=null;setBusy(false);setMessages([]);setInput('');},[]);
 const close=useCallback(()=>{reset();setOpen(false);},[reset]);
 useEffect(()=>{reset();setOpen(false);return()=>{pending.current?.abort();};},[state.accountId,reset]);
 useEffect(()=>{
  function shortcut(e:KeyboardEvent){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='j'){e.preventDefault();if(open)close();else setOpen(true);}}
  function fromWorkspace(event:Event){const detail=(event as CustomEvent<{prompt?:string}>).detail;reset();setInput(detail?.prompt||'');setOpen(true);}
  window.addEventListener('keydown',shortcut);window.addEventListener('presales-assistant-open',fromWorkspace);
  return()=>{window.removeEventListener('keydown',shortcut);window.removeEventListener('presales-assistant-open',fromWorkspace);};
 },[open,close,reset]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[messages,busy]);
 async function send(){
  const value=input.trim();if(!value||busy)return;
  const controller=new AbortController();pending.current=controller;
  const userId=randomId(),history=messages.slice(-10).map(({role,text})=>({role,text}));
  setMessages(prev=>[...prev,{id:userId,role:'user',text:value}]);setInput('');setBusy(true);
  try{
   const result=await localApi<{answer:string;sources:Source[]}>('/api/knowledge/ask',{method:'POST',signal:controller.signal,body:JSON.stringify({question:value,history})});
   if(pending.current!==controller||controller.signal.aborted)return;
   setMessages(prev=>[...prev,{id:randomId(),role:'assistant',text:result.answer,sources:result.sources}]);
  }catch(e){
   if(pending.current!==controller||controller.signal.aborted)return;
   setMessages(prev=>prev.filter(m=>m.id!==userId));setInput(value);toast.error(e instanceof Error?e.message:'发送失败，请重试');
  }finally{if(pending.current===controller){pending.current=null;setBusy(false);textarea.current?.focus();}}
 }
 return <><button className="assistant-launcher" aria-label="打开知识助手" onClick={()=>setOpen(true)}><MessageCircle size={17}/><span>知识助手</span><kbd>⌘ J</kbd></button>
 <Dialog open={open} onOpenChange={value=>value?setOpen(true):close()} modal={false}><DialogContent className="assistant-panel assistant-simple" showCloseButton={false} onInteractOutside={e=>e.preventDefault()} onOpenAutoFocus={e=>{e.preventDefault();textarea.current?.focus();}}>
 <DialogHeader><DialogTitle>知识助手</DialogTitle><DialogDescription className="sr-only">根据公共资料回答问题并提供出处。</DialogDescription><div className="assistant-header-actions"><button aria-label="新对话" title="新对话" disabled={busy||!messages.length} onClick={()=>{reset();textarea.current?.focus();}}><Plus size={17}/></button><button aria-label="关闭知识助手" title="关闭" onClick={close}><X size={17}/></button></div></DialogHeader>
 <div className="assistant-messages" aria-live="polite">{!messages.length&&<div className="assistant-empty"><MessageCircle size={28}/><h3>有什么想了解的？</h3><p>直接提问，答案会附上资料出处。</p></div>}{messages.map(m=><article key={m.id} className={'assistant-message '+m.role}><MarkdownReply text={m.text}/>{!!m.sources?.length&&<div className="assistant-sources">{m.sources.map(s=><details key={s.id}><summary>{s.id} · {s.title} · {s.version} · 第 {s.page} 页/节</summary><p>{s.excerpt}</p><button className="file-open" onClick={()=>void downloadApiFile(s.download_url,s.title).catch(e=>toast.error(e instanceof Error?e.message:'下载失败'))}>下载原文件</button></details>)}</div>}</article>)}{busy&&<p className="assistant-pending" role="status">正在查阅资料…</p>}<div ref={end}/></div>
 <form className="assistant-compose" onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={textarea} aria-label="向知识助手提问" placeholder="输入你的问题…" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>{busy?<button type="button" aria-label="停止回答" onClick={()=>{pending.current?.abort();pending.current=null;setBusy(false);}}><Square size={13}/></button>:<button aria-label="发送消息" disabled={!input.trim()}><ArrowUp size={18}/></button>}<small>Enter 发送 · Shift + Enter 换行</small></form>
 </DialogContent></Dialog></>;
}
