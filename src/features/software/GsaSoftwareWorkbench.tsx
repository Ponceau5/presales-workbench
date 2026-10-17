import {useChatAttachments,type ChatAttachment} from "./ChatAttachments";
import { F7CostFlow } from "./F7CostFlow";
import { WorkflowStudio, type FlowTask, type SkillTrial } from "./WorkflowStudio";
import { randomId } from "@/lib/id";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { FileText, LoaderCircle, ArrowUp, X, Download, Sparkles, ArrowRight, CheckCircle2, Bookmark, Copy, Trash2, MessageSquare } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { localApi, localApiBase, localApiReady, clearLocalApiSession, currentPerson } from "@/lib/localApi";
import "./gsa-software.css";
import { stages } from "@/lib/stages";
import { FileSamples } from "./FileSamples";
import { CostReviewEditor } from "./CostReviewEditor";
import { SharedProjectMaterials } from "./SharedProjectMaterials";
import { MarkdownReply, SourceFigure } from "./MarkdownReply";
import F7TableTemplate, { F7ReviewSummary, type F7TemplateKind, type F7DemoScenario } from "./F7TableTemplate";
import F8TableTemplate, { F8ReviewSummary, type F8TemplateKind } from "./F8TableTemplate";

type Inputs = {
  scope: "schedule" | "phases" | "custom"; point_low: number; point_high: number; device_count: number;
  sampling_seconds: number; retention_years: number; record_types: number; cache_days: number;
  events_per_device_day: number; waveform_devices: number; waveforms_per_device_day: number;
  backup_copies: number; raid_usable_ratio: number; headroom: number; phase_ids: string[];
  sampling_confirmed: boolean; scope_confirmed: boolean; assumptions_confirmed: boolean; scope_note: string;
};
type Material = {
  manifest: {id:string;title:string;sha256:string}[];
  schedule: {total:number;totals:Record<string,number>; rows:{device_type:string;quantity:number;points_per_device:number;points:number;source:string;warning:string}[]};
  phases:{id:string;name:string;range:string;low:number;high:number;mw:number;devices_low:number;devices_high:number}[];
  warnings:string[]; spec_pages:{page:number;text:string}[];
  historical:{name:string;spec:string;quantity:number}[];
};
type Storage = {points:number;samples_per_second:number;time_series_gb:number;pg_gb:number;cache_gb:number;backup_gb:number;raw_data_gb:number};
type Calculation = {points:{low:number;high:number;mid:number;source:string};low:Storage;high:Storage;limitations:string[]};
type Run = {selected_option?:string;source_hashes?:{id:string;sha256:string}[];equipment_revision?:number;created_at:string;stage_message?:string;draft?:{options:{name:string}[];recommended_index:number};preview?:string;id:string;status:string;revision:number;inputs:Inputs;calculation:Calculation;narrative:string|null;error:string|null;provider:string;model:string;reviewed_by:string|null;review_note:string|null};
type Workflow = {demo_reset_at?:string;status:string;revision:number;equipment_revision:number;equipment_note:string|null;request_note:string|null;run_id:string|null;merged_file:string|null};
type CollaborationMessage={config_id?:string;id:string;title:string;body:string;sender:string;recipient:string;kind:string;created_at:string;is_read:number;processed?:boolean};
type ChatTurn={attachments?:ChatAttachment[];runtimeRunId?:string;costPreflight?:boolean;trial?:boolean;workflow?:{id:string;task:string;review:boolean;export:boolean};artifactId?:string;artifactTitle?:string;runId?:string;createdAt?:string;demoScenario?:F7DemoScenario;id:string;question:string;answer:string;steps:{label:string;state:string}[];status:"running"|"done"|"error"|"stopped"};
type Favorite={id:string;sourceId:string;title:string;text:string;turns:ChatTurn[];runId:string|null;createdAt:string;conversationId?:string;runQuestion?:string};
type F7HumanTask={id:string;kind:"access"|"followup"|"pricing"|"review";turnId:string;title:string;question:string;status:"open"|"done";createdAt:string;draft?:string;conversationId?:string;demoScenario?:F7DemoScenario};
function AgentReply({text,children,onFavorite,favorited=false,canSave=true}:{text:string;children?:ReactNode;onFavorite?:()=>void;favorited?:boolean;canSave?:boolean}){
 const [copied,setCopied]=useState(false);const [copyError,setCopyError]=useState(false);
 return <div className="gsa-reply"><i className="gsa-reply-avatar"><Sparkles size={17}/></i><div className="gsa-reply-body">{children??<MarkdownReply text={text}/>}{text&&<div className="gsa-message-tools">{onFavorite&&<button disabled={!canSave} aria-label={favorited?"取消收藏":"收藏对话"} title={favorited?"取消收藏":"收藏对话"} onClick={onFavorite}><Bookmark size={15} fill={favorited?"currentColor":"none"}/></button>}<button aria-label={copied?"已复制":"复制完整回复"} title={copied?"已复制":"复制完整回复"} onClick={()=>void navigator.clipboard.writeText(text).then(()=>{setCopied(true);setCopyError(false);setTimeout(()=>setCopied(false),1600);}).catch(()=>setCopyError(true))}>{copied?<CheckCircle2 size={15}/>:<Copy size={15}/>}</button>{copyError&&<small>复制失败，请选择文本复制</small>}</div>}</div></div>;
}
type Artifact={legacy?:boolean;id:string;source_id:string;title:string;content:string;revision:number;adopted_by:string;created_at:string};
type Audit = {id:string;action:string;actor:string;detail:string;created_at:string};

const softwareTasks=[{id:"survey",name:"项目资料摸排",prompt:"请按项目资料摸排任务书输出本项目的资料摸排报告"},{id:"gap",name:"需求差距分析与澄清",prompt:"请按任务书分别输出内部差距分析表和客户澄清表"},{id:"functions",name:"软件功能清单",prompt:"请按任务书制作软件功能清单，先确认产品线、国内海外口径、范围和参考旧清单"},{id:"server",name:"服务器规格方案",prompt:"请根据当前设备清单生成服务器规格方案"},{id:"cost",name:"内部成本报价单",prompt:"请按任务书制作内部成本报价单，先确认范围、数量与价格依据"}];
const defaults:Inputs={scope:"phases",point_low:71000,point_high:83000,device_count:2390,
 sampling_seconds:60,retention_years:3,record_types:1,cache_days:1095,events_per_device_day:0,
 waveform_devices:0,waveforms_per_device_day:0,backup_copies:1,raid_usable_ratio:2/3,headroom:0.2,
 phase_ids:["p1","p2","p3"],sampling_confirmed:false,scope_confirmed:false,assumptions_confirmed:false,
 scope_note:""};
const labels:Record<string,string>={running:"生成中",review:"待你审核",approved:"已批准",rejected:"已退回",failed:"生成失败",stale:"可采纳或继续修改"};
function gapParts(text:string){const found=[...text.matchAll(/^#{1,3}\s*(内部差距分析表|客户澄清表)[^\n]*\n/gm)];if(new Set(found.map(m=>m[1])).size!==2)return [];return found.map((m,i)=>({title:m[1],content:text.slice(m.index,found[i+1]?.index??text.length).trim()}));}
const json=(data:unknown)=>({method:"POST",body:JSON.stringify(data)});
const fmt=(v:number)=>v.toLocaleString("zh-CN",{maximumFractionDigits:2});

export function GsaSoftwareWorkbench({projectId="GSA02",stageId="F5"}:{projectId?:string;stageId?:string}){
 const attachments=useChatAttachments(projectId,{stageId,question:()=>question});
 const specialized=projectId==="GSA02"&&stageId==="F5";
 const base=specialized?"/api/projects/GSA02/software":`/api/projects/${encodeURIComponent(projectId)}/workspaces/${stageId}`;
 const stage=stages.find(s=>s.id===stageId)??(stageId==="F5"?{title:"软件技术支持"}:undefined);
 const durableBase=`/api/projects/${encodeURIComponent(projectId)}/workspaces/${stageId}`;
 const storageScope=projectId+(stageId==="F5"?"":":"+stageId);
 const skillTrial=useRef<SkillTrial|null>(null);
 const [trialTask,setTrialTask]=useState<FlowTask|null>(null);
 const [sampleIds,setSampleIds]=useState<string[]>([]);
 const [roleTaskId,setRoleTaskId]=useState<string|null>(null);
 const [roleTasks,setRoleTasks]=useState<{id:string;name:string;prompt:string}[]>(softwareTasks);
 const [selectedUpstream,setSelectedUpstream]=useState<string[]>([]);
 const [selectedPages,setSelectedPages]=useState<{document_id:string;page:number}[]>([]);
 const [documents,setDocuments]=useState<{id:string;title:string;version:string;page_count:number}[]>([]);
 const [pageNumbers,setPageNumbers]=useState<Record<string,string>>({});
 const {state,dispatch}=useWorkbench(); const account=state.accountId;
 const [artifacts,setArtifacts]=useState<Artifact[]>([]);
 const [materials,setMaterials]=useState<Material|null>(null);
 const [inputs,setInputs]=useState<Inputs>(defaults);
 const [runs,setRuns]=useState<Run[]>([]); const [audit,setAudit]=useState<Audit[]>([]);
 const [calc,setCalc]=useState<Calculation|null>(null); const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");const [question,setQuestion]=useState("");
 const [note]=useState(""); const [model,setModel]=useState<{configured:boolean;provider:string;model:string}|null>(null);
 const [costParameters,setCostParameters]=useState<Record<string,string|number>|null>(null);
 const [f7Demo,setF7Demo]=useState<F7DemoScenario|null>(null);
 const [drawer,setDrawer]=useState<"sources"|"parameters"|"server"|"workflow"|"favorites"|"files"|"tracking"|"f7Human"|"f7Template"|"costParameters"|"flows"|"costFlow"|"procurement"|null>(null);
 const [flow,setFlow]=useState<Workflow|null>(null);
 const [optionIndex,setOptionIndex]=useState(0); const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const canEdit=!specialized||state.role==="软件产品"||!!currentPerson()?.is_admin; const canReview=!specialized||state.role==="软件产品"||!!currentPerson()?.is_admin; const canMerge=specialized&&(state.role==="解决方案"||!!currentPerson()?.is_admin);
 const conversationKey="presales-conversation:"+storageScope+":"+account;
 function savedConversation(){try{return JSON.parse(sessionStorage.getItem(conversationKey)||"null");}catch{return null;}}
 const [started,setStarted]=useState(()=>!!savedConversation()?.started);
 const [showServer,setShowServer]=useState(()=>!!savedConversation()?.showServer);
 const [messages,setMessages]=useState<CollaborationMessage[]>([]);
 const [chatTurns,setChatTurns]=useState<ChatTurn[]>(()=>savedConversation()?.turns??[]);
 const [conversationId,setConversationId]=useState(()=>savedConversation()?.conversationId||randomId());
 const [runQuestion,setRunQuestion]=useState(()=>savedConversation()?.runQuestion??"");
 const isF7=stageId==="F7";
 const isF8=stageId==="F8";
 const isSales=isF7||isF8;
 const [salesFlow,setSalesFlow]=useState<{active:{definition:{tasks:FlowTask[]}};draft?:{id:string;definition:{tasks:FlowTask[]}}|null}|null>(null);
 const workspaceTasks=salesFlow?.draft?.definition.tasks||salesFlow?.active.definition.tasks||[];
 async function loadSalesFlow(){setSalesFlow(await localApi(durableBase+"/flows"));}
 const [costPending,setCostPending]=useState(()=>!!savedConversation()?.costPending);
 const [f7Tasks,setF7Tasks]=useState<F7HumanTask[]>([]);
 const [f7Processed,setF7Processed]=useState<string[]>([]);
 const [f7Hidden,setF7Hidden]=useState<string[]>([]);
 const [f7HumanId,setF7HumanId]=useState<string|null>(null);
 const [f7HumanInput,setF7HumanInput]=useState("");
 const [f7TemplateKind,setF7TemplateKind]=useState<F7TemplateKind|F8TemplateKind>(isF8?"mapping":"cost");
 const [f7TemplateReturn,setF7TemplateReturn]=useState<"sources"|"f7Human"|null>(null);
 const [f7TemplateDraft,setF7TemplateDraft]=useState("");
 const [f7TemplateAt,setF7TemplateAt]=useState("");
 const [f7SelectedCollab,setF7SelectedCollab]=useState<string|null>(null);
 const [f7SelectedTracking,setF7SelectedTracking]=useState<string|null>(null);

 function conversationContext(){return JSON.stringify({turns:chatTurns.filter(t=>t.status==="done").map(t=>({question:t.question,answer:t.answer,demoScenario:t.demoScenario?{overrides:t.demoScenario.overrides}:undefined})),current_scheme:showServer?current?.narrative:null}).slice(-24000);}


 const streamController=useRef<AbortController|null>(null);
 useEffect(()=>()=>streamController.current?.abort(),[]);
 const baselineAudit=useRef<Set<string>|null>(null);
 const sessionAccount=useRef(account);
 useEffect(()=>{if(sessionAccount.current===account)return;sessionAccount.current=account;const saved=savedConversation();setStarted(!!saved?.started);setShowServer(!!saved?.showServer);setChatTurns(saved?.turns??[]);setRunQuestion(saved?.runQuestion??"");setConversationId(saved?.conversationId||randomId());setRestoredRun(null);setFavoriteContext("");setF7Tasks([]);setF7Processed([]);setF7Hidden([]);baselineAudit.current=null;},[account]);
 const pendingSave=useRef<(()=>void)|null>(null);
 useEffect(()=>()=>pendingSave.current?.(),[]);
 const [storageReady,setStorageReady]=useState(false);
 const storageRevision=useRef(0);const saveQueue=useRef(Promise.resolve());const lastSaved=useRef("");const migrateDialogs=useRef(false);
 const [favorites,setFavorites]=useState<Favorite[]>([]);
 const [favoriteContext,setFavoriteContext]=useState("");
 const [restoredRun,setRestoredRun]=useState<Run|null>(()=>savedConversation()?.run??null);
 const favoriteKey="presales-favorites:"+storageScope+":"+account;
 useEffect(()=>{try{const value=JSON.parse(localStorage.getItem(favoriteKey)||"[]");setFavorites(Array.isArray(value)?value.filter(v=>v&&typeof v.title==="string"&&Array.isArray(v.turns)):[]);}catch{setFavorites([]);}},[favoriteKey]);
 useEffect(()=>{
  let cancelled=false;
  void localApi<{revision:number;value:{current:ReturnType<typeof savedConversation>;favorites:Favorite[];selectedPages?:{document_id:string;page:number}[];pageNumbers?:Record<string,string>;f7Tasks?:F7HumanTask[];f7Processed?:string[];f7Hidden?:string[]}|null}>(durableBase+"/state").then(saved=>{
   if(cancelled)return;storageRevision.current=saved.revision;
   if(saved.value){const c=saved.value.current;
    if(c){skillTrial.current=c.skillTrial||null;setTrialTask(c.skillTrial?.task||null);setSelectedUpstream(c.selectedUpstream||[]);setCostPending(!!c.costPending);setSampleIds(c.sampleIds??[]);setRoleTaskId(c.roleTaskId??null);setStarted(!!c.started);setShowServer(!!c.showServer);setChatTurns((c.turns??[]).map((t:ChatTurn)=>t.status==="running"?{...t,status:"stopped",answer:t.answer+"\n\n上次生成已中断，请继续发送请求。"}:t));setRunQuestion(c.runQuestion||"");setConversationId(c.conversationId||randomId());setRestoredRun(c.run??null);setInputs(c.inputs??c.run?.inputs??defaults);setPendingPrompt(c.generationPrompt||"");setPendingAt(c.pendingAt||new Date().toISOString());setNotice(c.chatNotice||"");setNoticeAt(c.noticeAt||new Date().toISOString());}
    setFavorites(saved.value.favorites??[]);setSelectedPages(saved.value.selectedPages??[]);setPageNumbers(saved.value.pageNumbers??{});
    if(isSales){setF7Tasks((saved.value.f7Tasks??[]).map(task=>({...task,draft:task.draft||c?.turns?.find((turn:ChatTurn)=>turn.id===task.turnId)?.answer||""})));setF7Processed(saved.value.f7Processed??[]);setF7Hidden(saved.value.f7Hidden??[]);}
   }
   migrateDialogs.current=!saved.value;setStorageReady(true);
  }).catch(e=>{if(!cancelled)setError("服务端对话读取失败："+e.message);});
  return()=>{cancelled=true;};
 },[account]);
 const current=restoredRun?(runs.find(r=>r.id===restoredRun.id)??restoredRun):runs[0]; const running=current?.status==="running";

 useEffect(()=>{setOptionIndex(current?.draft?.recommended_index??0);},[current?.id,current?.draft?.recommended_index]);
 useEffect(()=>{
  if(!running||!current)return;
  const controller=new AbortController();const id=current.id;
  void (async()=>{try{
   const response=await fetch(localApiBase+base+"/runs/"+id+"/stream",{headers:{Authorization:"Bearer "+sessionStorage.getItem("presales-local-api-token")},signal:controller.signal});
   if(!response.ok||!response.body)throw new Error("方案实时连接未建立，正在重新同步");
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
   while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});const events=buffer.split("\n\n");buffer=events.pop()||"";for(const event of events){const line=event.split("\n").find(v=>v.startsWith("data: "));if(line){const run=JSON.parse(line.slice(6)) as Run;setRuns(rows=>rows.map(r=>r.id===id?run:r));}}if(chunk.done)break;}
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"实时连接中断，正在同步任务状态");}})();
  return()=>controller.abort();
 },[current?.id,running]);
 const confirmed=inputs.sampling_confirmed&&inputs.scope_confirmed&&inputs.assumptions_confirmed&&!!inputs.scope_note.trim();
 const streamRef=useRef<HTMLDivElement>(null);
 const [pendingAt,setPendingAt]=useState(()=>savedConversation()?.pendingAt||new Date().toISOString());
 const [generationPrompt,setPendingPrompt]=useState(()=>savedConversation()?.generationPrompt||"");
 function setGenerationPrompt(text:string){setPendingAt(new Date().toISOString());setPendingPrompt(text);}
 const [noticeAt,setNoticeAt]=useState(()=>savedConversation()?.noticeAt||new Date().toISOString());
 const [chatNotice,setNotice]=useState(()=>savedConversation()?.chatNotice||"");
 function setChatNotice(text:string){setNoticeAt(new Date().toISOString());setNotice(text);}
 const [dirty,setDirty]=useState(false);
 useEffect(()=>{
  if(sessionAccount.current!==account)return;
  const saved={sampleIds,roleTaskId,started,showServer,turns:chatTurns,runQuestion,conversationId,run:showServer?current:null,generationPrompt,pendingAt,chatNotice,noticeAt};
  try{sessionStorage.setItem(conversationKey,JSON.stringify(saved));if(started)localStorage.setItem("presales-dialogue:"+storageScope+":"+account+":"+conversationId,JSON.stringify(saved));}catch{setError("对话未保存，本机存储空间不足。");}
 },[started,showServer,chatTurns,runQuestion,conversationKey,conversationId,current,generationPrompt,pendingAt,chatNotice,noticeAt]);

 useEffect(()=>{const stream=streamRef.current;if(stream)stream.scrollTop=stream.scrollHeight;},[audit.length,runs.length,generationPrompt,chatNotice,chatTurns]);
 useEffect(()=>{const stream=streamRef.current;if(stream&&stream.scrollHeight-stream.scrollTop-stream.clientHeight<140)stream.scrollTop=stream.scrollHeight;},[current?.preview,current?.status]);
 useEffect(()=>{
  if(!storageReady)return;
  const value={current:{skillTrial:skillTrial.current,selectedUpstream,costPending,sampleIds,roleTaskId,inputs,started,showServer,turns:chatTurns,runQuestion,conversationId,run:showServer?current:null,generationPrompt,pendingAt,chatNotice,noticeAt},favorites,selectedPages,pageNumbers,...(isSales?{f7Tasks,f7Processed,f7Hidden}:{})};
  const encoded=JSON.stringify(value);if(encoded===lastSaved.current)return;
  const save=()=>{
   saveQueue.current=saveQueue.current.then(async()=>{
    if(encoded===lastSaved.current)return;
    const dialogues:Record<string,unknown>={};
    if(migrateDialogs.current)for(const f of favorites){const id=f.conversationId||f.id;try{const old=JSON.parse(localStorage.getItem("presales-dialogue:"+storageScope+":"+account+":"+id)||"null");if(old)dialogues[id]=old;}catch{/* Ignore unreadable legacy dialogue. */}}
    const saved=await localApi<{revision:number}>(durableBase+"/state",json({expected_revision:storageRevision.current,value:{...value,dialogues}}));
    storageRevision.current=saved.revision;lastSaved.current=encoded;migrateDialogs.current=false;
   }).catch(e=>setError("服务端保存失败，当前内容仍保留在此浏览器："+e.message));
  };
  pendingSave.current=save;const timer=setTimeout(save,350);
  return()=>clearTimeout(timer);
 },[storageReady,started,showServer,chatTurns,runQuestion,conversationId,current,generationPrompt,pendingAt,chatNotice,noticeAt,favorites,selectedPages,selectedUpstream,pageNumbers,inputs,costPending,trialTask,sampleIds,roleTaskId,f7Tasks,f7Processed,f7Hidden]);
 const change=(patch:Partial<Inputs>)=>{setInputs(v=>({...v,...patch}));setCalc(null);setDirty(true);};
 async function loadArtifacts(){const common=await localApi<Artifact[]>(durableBase+"/artifacts");return specialized?[...common,...(await localApi<Artifact[]>(base+"/artifacts")).map(a=>({...a,legacy:true}))]:common;}
 async function refresh(){
   if(!specialized){
    const [m,a,d]=await Promise.all([localApi<{configured:boolean;provider:string;model:string}>("/api/model/status"),localApi<Artifact[]>(base+"/artifacts"),isSales?localApi<{id:string;title:string;version:string;page_count:number}[]>(`/api/projects/${encodeURIComponent(projectId)}/documents`):Promise.resolve(null)]);
    setMessages(await localApi<CollaborationMessage[]>(durableBase+"/collaboration"));setModel(m);setArtifacts(a);if(d)setDocuments(d);return;
   }
   const [r,a,m,f,notifications]=await Promise.all([localApi<Run[]>(base+"/runs"),localApi<Audit[]>(base+"/audit"),
    localApi<{configured:boolean;provider:string;model:string}>("/api/model/status"),localApi<Workflow>(base+"/workflow"),localApi<CollaborationMessage[]>(base+"/collaboration")]);
   if(baselineAudit.current===null)baselineAudit.current=new Set(a.map(item=>item.id));
   setArtifacts(await loadArtifacts());
   const resetKey="presales-demo-reset:"+storageScope+":"+account;
   if(f.demo_reset_at&&localStorage.getItem(resetKey)!==f.demo_reset_at){
    streamController.current?.abort();setStarted(false);setShowServer(false);setRestoredRun(null);setChatTurns([]);setRunQuestion("");setPendingPrompt("");setNotice("");setQuestion("");setFavoriteContext("");setConversationId(randomId());setDrawer(null);setInputs(defaults);
    sessionStorage.removeItem(conversationKey);localStorage.setItem(resetKey,f.demo_reset_at);
   }
   setRuns(r);setAudit(a);setModel(m);setFlow(f);setMessages(notifications);
 }
 async function load(){
   if(!account||!localApiReady(account)){setError("本机服务尚未登录。请重新登录或在设置中连接服务。");return;}
   try{
    await refresh();
    await loadSalesFlow();
    if(stageId==="F7")setCostParameters(await localApi(base+"/cost-parameters"));
    if(stageId==="F5"){const cfg=await localApi<{tasks:{id:string;name:string;prompt:string}[]}|null>(`/api/projects/${encodeURIComponent(projectId)}/software-config`);setRoleTasks(cfg?.tasks??softwareTasks);}
    if(specialized){setDocuments(await localApi(`/api/projects/${encodeURIComponent(projectId)}/documents`));const m=await localApi<Material>(base+"/materials");setMaterials(m);}
    else if(!isSales)setDocuments(await localApi(`/api/projects/${encodeURIComponent(projectId)}/documents`));
    setError("");
   }catch(e){setError(e instanceof Error?e.message:"资料读取失败");}
 }
 useEffect(()=>{void load();},[account]); // 数据由登录账号的服务端会话获取。
 useEffect(()=>{if(!isF7||model?.configured!==false)return;let cancelled=false;void localApi<F7DemoScenario>(base+"/demo-scenario").then(data=>{if(!cancelled)setF7Demo(data);}).catch(e=>{if(!cancelled)setError("模拟 CRM 数据读取失败："+e.message);});return()=>{cancelled=true;};},[isF7,model?.configured,base]);
 useEffect(()=>{
  if(!account||!localApiReady(account))return;
  const timer=setInterval(()=>{if(!account||!localApiReady(account))return;void refresh().catch(e=>{const message=e instanceof Error?e.message:String(e);if(message.includes("请先登录"))clearLocalApiSession();setError(message);});},4000);
  return()=>clearInterval(timer);
 },[running,account]);
 async function act(fn:()=>Promise<void>){
  setBusy(true);setError("");
  try{await fn();}catch(e){setError(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}
 }
 function openF7Template(kind:F7TemplateKind|F8TemplateKind,returnTo:"sources"|"f7Human"|null=null,draft="",generatedAt=""){setF7TemplateKind(kind);setF7TemplateReturn(returnTo);setF7TemplateDraft(draft);setF7TemplateAt(generatedAt);setDrawer("f7Template");}
 function outputTitle(t:ChatTurn){if(isSales&&t.question.includes("资料摸排"))return stageId+" 项目资料摸排报告";if(isF7&&t.artifactTitle)return t.artifactTitle;if(isF7)return (/报价|销售价|标价/.test(t.question)?"报价表":"成本表")+(t.demoScenario?"（模拟演示）":"");if(isF8&&t.artifactTitle)return t.artifactTitle;if(isF8)return /报价|销售价|定价/.test(t.question)?"客户报价表":"BOQ 映射表";if(stageId!=="F5")return t.artifactTitle||stage?.title||"工作成果";return t.artifactTitle|| (/偏离/.test(t.question)?"技术应答与偏离表":/澄清/.test(t.question)?"软件澄清表":/核对/.test(t.question)?"软件需求核对":"软件支持成果");}
 async function adoptOutput(t:ChatTurn,sourceConversationId=conversationId){await localApi(durableBase+"/artifacts/adopt",json({source_id:t.artifactId?artifacts.find(a=>a.id===t.artifactId)?.source_id||t.id:t.id,title:outputTitle(t),content:t.answer,conversation_id:sourceConversationId}));await refresh();}
 async function downloadOutput(a:Artifact,format="md"){
  const response=await fetch(localApiBase+(a.legacy?base:durableBase)+"/artifacts/"+a.id+"/download?format="+format,{headers:{Authorization:"Bearer "+sessionStorage.getItem("presales-local-api-token")}});
  if(!response.ok)throw new Error("下载失败");
  const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=url;link.download=`${projectId}_${a.title}_V${a.revision}.${format}`;link.click();URL.revokeObjectURL(url);
 }
 const result=calc??current?.calculation;
 const f7HumanTask=f7Tasks.find(task=>task.id===f7HumanId);
 const f7OpenTasks=f7Tasks.filter(task=>task.status==="open");
 const f7PendingFollowup=f7OpenTasks.filter(task=>task.kind!=="review");
 const f7PendingReview=f7OpenTasks.filter(task=>task.kind==="review");
 const f7Collaboration=[
  ...messages.map(m=>({id:"api:"+m.id,followupId:"",title:m.title,source:m.sender==="solution"?"解决方案":m.sender,detail:m.body,status:m.processed?"已处理":"待处理",at:m.created_at})),
  ...state.followups.filter(f=>f.projectId===projectId&&f.owner===state.role&&f.createdBy!==account).map(f=>({id:"followup:"+f.id,followupId:f.id,title:f.title,source:f.createdRole||"其他岗位",detail:f.source,status:f.status==="done"?"已处理":"待处理",at:f.completedAt||""})),
  ...state.deliveries.filter(d=>d.projectId===projectId&&d.toStage===stageId&&d.owner===state.role&&d.senderRole!==state.role&&d.status!=="returned").map(d=>({id:"delivery:"+d.id,followupId:"",title:d.title,source:d.senderRole,detail:`${d.fromStage} → ${stageId} · ${d.version}\n${d.text}\n依据：${d.evidence}`,status:d.status==="accepted"?"已接收":"待处理",at:d.at})),
 ].filter(task=>!f7Hidden.includes(task.id));
 const f7PendingCollaboration=f7Collaboration.filter(task=>task.status==="待处理"&&!f7Processed.includes(task.id)).length;
 function f7TaskBlocked(task:F7HumanTask){return task.status==="open"&&f7Tasks.some(row=>row.turnId===task.turnId&&row.status==="open"&&(task.kind==="followup"&&row.kind==="access"||task.kind==="review"&&(row.kind==="access"||row.kind==="pricing")));}
 function openF7Human(task:F7HumanTask){setF7HumanId(task.id);setF7HumanInput("");setDrawer("f7Human");}
 function openNextF7Human(task?:F7HumanTask){
  setDrawer(null);
  setF7HumanId(null);
  if(task)window.setTimeout(()=>openF7Human(task),160);
 }
 function continueF7Gate(task:F7HumanTask){
  setF7Tasks(rows=>rows.map(row=>row.id===task.id?{...row,status:"done"}:row));
  const next=f7Tasks.find(row=>row.turnId===task.turnId&&row.status==="open"&&(task.kind==="access"?row.kind==="followup":row.kind==="review"))||f7Tasks.find(row=>row.turnId===task.turnId&&row.kind==="review"&&row.status==="open");
  openNextF7Human(next);
 }
 function deferF7Followup(task:F7HumanTask){
  const review=f7Tasks.find(row=>row.turnId===task.turnId&&row.kind==="review"&&row.status==="open");
  openNextF7Human(review);
 }
 function acceptF7DemoFollowup(task:F7HumanTask){
  setF7Tasks(rows=>rows.map(row=>row.id===task.id?{...row,status:"done"}:row));
  const review=f7Tasks.find(row=>row.turnId===task.turnId&&row.kind==="review"&&row.status==="open");
  openNextF7Human(review);
 }
 async function submitF7Human(){
  if(!f7HumanTask||busy||f7HumanTask.kind==="access")return;
  const task=f7HumanTask;
  const reply=f7HumanInput.trim();
  if(!reply)return;
  setDrawer(null);setF7HumanInput("");
  await act(async()=>{
   await streamReply((task.kind==="followup"||task.kind==="pricing"?`针对“${task.question}”补充人工确认信息：${reply}。请据此继续处理，${isF8?"未确认的对应关系、数量或金额保持待补。":"仍缺少依据的金额保持待补。"}`:`请按人工审核意见修改刚才的${task.title}：${reply}。保留原始依据，不能推断缺失的${isF8?"映射、数量、价格":"价格"}或审批结果。`).slice(0,1000),undefined,true);
   setF7Tasks(rows=>rows.map(row=>row.turnId===task.turnId?{...row,status:"done"}:row));
  });
 }
 async function approveF7Draft(){
  if(!f7HumanTask||f7HumanTask.kind!=="review")return;
  const turn=chatTurns.find(t=>t.id===f7HumanTask.turnId)??(f7HumanTask.draft?{id:f7HumanTask.turnId,question:f7HumanTask.question,answer:f7HumanTask.draft,steps:[],status:"done" as const,demoScenario:f7HumanTask.demoScenario}:undefined);
  if(!turn||turn.status!=="done")return;
  await act(async()=>{await adoptOutput(turn,f7HumanTask.conversationId||conversationId);setF7Tasks(rows=>rows.map(row=>row.id===f7HumanTask.id?{...row,status:"done"}:row));setDrawer(null);setChatNotice("已保存");});
 }
 function persistFavorites(next:Favorite[]){try{localStorage.setItem(favoriteKey,JSON.stringify(next));setFavorites(next);}catch{setError("收藏未保存，本机存储空间不足或不可用。");}}
 function favoriteReply(sourceId:string,text:string,title:string){
  const saved=favorites.find(f=>f.sourceId===sourceId||f.conversationId===conversationId);
  if(saved){persistFavorites(favorites.filter(f=>f.id!==saved.id));return;}
  persistFavorites([{id:randomId(),sourceId,title:title.slice(0,40),text,turns:chatTurns.filter(t=>t.status==="done"),conversationId,runQuestion,runId:sourceId===current?.id||showServer?current?.id??null:null,createdAt:new Date().toISOString()},...favorites].slice(0,32));
 }
 useEffect(()=>{
  if(!started)return;
  const saved=favorites.find(f=>f.conversationId===conversationId);if(!saved)return;
  const turns=chatTurns.filter(t=>t.status!=="running");
  if(JSON.stringify(saved.turns)===JSON.stringify(turns)&&saved.runId===(showServer?current?.id??null:null)&&saved.runQuestion===runQuestion)return;
  persistFavorites(favorites.map(f=>f.id===saved.id?{...f,turns,runId:showServer?current?.id??null:null,runQuestion}:f));
 },[chatTurns,current?.id,conversationId,runQuestion,showServer]);
 async function restoreFavorite(favorite:Favorite){
  if(busy)return;
  const id=favorite.conversationId||favorite.id;
  let saved:ReturnType<typeof savedConversation>=await localApi(durableBase+"/dialogues/"+encodeURIComponent(id));
  try{if(!saved)saved=JSON.parse(localStorage.getItem("presales-dialogue:"+storageScope+":"+account+":"+id)||"null");}catch{/* Older favorite remains readable. */}
  const selectedTurns:ChatTurn[]=saved?.turns??favorite.turns;
  const runId=saved?.run?.id??favorite.runId;
  let run:Run|null=null;
  if(runId)run=await localApi<Run>(base+"/runs/"+runId);
  setFavoriteContext(JSON.stringify({title:favorite.title,selected_reply:favorite.text,conversation:selectedTurns.map(t=>({question:t.question,answer:t.answer}))}).slice(0,12000));
  if(!favorite.conversationId)persistFavorites(favorites.map(f=>f.id===favorite.id?{...f,conversationId:id}:f));
  setSampleIds(saved?.sampleIds??[]);setRoleTaskId(saved?.roleTaskId??null);setConversationId(id);setRunQuestion(saved?.runQuestion||favorite.runQuestion||favorite.title);setRestoredRun(run);setChatTurns(selectedTurns);setShowServer(!!run);setStarted(true);
  setPendingPrompt(saved?.generationPrompt||"");setPendingAt(saved?.pendingAt||new Date().toISOString());setNotice(saved?.chatNotice||"");setNoticeAt(saved?.noticeAt||new Date().toISOString());
  if(!selectedTurns.length&&!run)setChatTurns([{id:favorite.id,question:favorite.title,answer:favorite.text,status:"done",steps:[],createdAt:favorite.createdAt}]);
  setQuestion("");setDrawer(null);
 }
 function selectShortcut(task:FlowTask,trial?:SkillTrial){
  if(!trial&&salesFlow?.draft){trial={draftId:salesFlow.draft.id,task,definition:salesFlow.draft.definition};}
  skillTrial.current=trial||null;setTrialTask(trial?.task||null);setRoleTaskId(task.id);setStarted(true);setShowServer(false);setQuestion('');
  if(isF7&&task.id==='procurement'){setDrawer('procurement');return;}
  if(isF7&&task.steps.some(s=>s.enabled&&s.capability==='cost')){setDrawer(null);if(trial)setCostParameters(v=>({...v,...Object.fromEntries(task.parameters.map(p=>[p.key,p.default]))}));setCostPending(false);void act(async()=>{await streamReply('请先核对成本估算所需资料：简洁列出已有资料、缺失项和可用默认参数。此时不生成成本表，等待确认或调整资料与参数。',undefined,true,task,true);setCostPending(true);});}
  else void act(()=>streamReply(task.prompt,undefined,false,task));
 }
 async function streamReply(text:string,collaboration?:{id:string;followupId:string},skipFollowup=false,taskOverride?:FlowTask,preflight=false,retryTurn?:ChatTurn){
  const testing=skillTrial.current;
  const id=retryTurn?.id||randomId();const controller=new AbortController();streamController.current=controller;
  let completedAnswer="";
  let generatedDemo:F7DemoScenario|undefined;
  let timedOut=false;
  const expire=()=>{timedOut=true;controller.abort();};
  let watchdog=setTimeout(expire,100000);
  setQuestion("");setChatTurns(turns=>[...turns.filter(t=>t.id!==id),{id,costPreflight:preflight,trial:!!testing,question:text,attachments:attachments.items.map(({preview,...item})=>item),artifactTitle:retryTurn?.artifactTitle||taskOverride?.name||testing?.task.name||workspaceTasks.find(t=>t.id===roleTaskId)?.name||roleTasks.find(t=>t.id===roleTaskId)?.name||chatTurns.at(-1)?.artifactTitle,answer:"",steps:[],status:"running",createdAt:new Date().toISOString()}]);
  const update=(event:{type:string;label?:string;state?:string;text?:string;message?:string;id?:string;data?:F7DemoScenario|ChatTurn["workflow"]})=>{
   clearTimeout(watchdog);watchdog=setTimeout(expire,100000);
   if(event.type==="error")throw new Error(event.message||"生成失败");
   if(event.type==="delta")completedAnswer+=event.text||"";
   if(event.type==="scenario")generatedDemo=event.data as F7DemoScenario;
   if(event.type==="runtime")setChatTurns(turns=>turns.map(t=>t.id===id?{...t,runtimeRunId:event.id}:t));
   if(event.type==="workflow")setChatTurns(turns=>turns.map(t=>t.id===id?{...t,workflow:event.data as ChatTurn["workflow"]}:t));
   setChatTurns(turns=>turns.map(t=>t.id!==id?t:{...t,answer:t.answer+(event.type==="delta"?event.text||"":""),demoScenario:event.type==="scenario"?event.data as F7DemoScenario:t.demoScenario,steps:event.type==="step"?[...t.steps.filter(s=>s.label!==event.label),{label:event.label||"",state:event.state||"done"}]:t.steps,status:event.type==="done"?"done":t.status}));
  };
  try{
   const response=await fetch(localApiBase+durableBase+(retryTurn?.runtimeRunId?"/runs/"+encodeURIComponent(retryTurn.runtimeRunId)+"/retry":"/ask-stream"),{...json({attachment_ids:attachments.items.map(f=>f.id),question:text,parent_run_id:isF7&&!preflight&&!testing&&/成本/.test(text)?[...chatTurns].reverse().find(t=>t.costPreflight&&t.runtimeRunId&&t.status==='done')?.runtimeRunId:undefined,cost_preflight:preflight,favorite_context:favoriteContext,conversation_context:conversationContext(),turn_id:id,cost_parameters:isF7?costParameters:undefined,flow_draft_id:testing?.draftId,test_run:!!testing,workflow_parameters:testing?Object.fromEntries(testing.task.parameters.map(p=>[p.key,costParameters?.[p.key]??p.default])):{},sample_ids:sampleIds,task_id:taskOverride?.id||testing?.task.id||roleTaskId,selected_pages:selectedPages,upstream_ids:selectedUpstream,stage_title:stage?.title||stageId,project_name:state.projects.find(p=>p.id===projectId)?.name||projectId}),headers:{"Content-Type":"application/json",Authorization:"Bearer "+sessionStorage.getItem("presales-local-api-token")},signal:controller.signal});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.detail||"生成请求失败");}
   if(!response.body)throw new Error("浏览器无法读取内容流");
   const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";let done=false;
   while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});const events=buffer.split("\n\n");buffer=events.pop()||"";for(const event of events){const line=event.split("\n").find(v=>v.startsWith("data: "));if(line){const data=JSON.parse(line.slice(6));update(data);if(data.type==="done")done=true;}}if(chunk.done)break;}
   if(!done)throw new Error("连接中断，当前结果未完成，请重试");
   await refresh();
   if(isSales&&!preflight&&!text.includes("资料摸排")&&!testing){
    const title=taskOverride?.name||(isF8?(/报价|销售价|定价/.test(text)?"客户报价表":"BOQ 映射表"):(/报价|销售价|标价/.test(text)?"报价表":"成本表"));
    const review:F7HumanTask={id:randomId(),kind:"review",turnId:id,title:`审核${title}${generatedDemo?"模拟":""}草稿`,question:text,status:"open",createdAt:new Date().toISOString(),draft:completedAnswer,conversationId,demoScenario:generatedDemo};
    const needsFollowup=!skipFollowup&&(isF8?title==="BOQ 映射表"&&/请(?:提供|补充|确认)|待(?:补|确认)|缺少|空白/.test(completedAnswer):generatedDemo?generatedDemo.demo_kind!=="gsa-cost-v1"&&title==="成本表":title==="成本表"&&/请(?:提供|补充|确认)|待(?:补|确认)|缺少.*(?:价格|依据|条件)/.test(completedAnswer));
    const followup:F7HumanTask={id:randomId(),kind:"followup",turnId:id,title:isF8?"客户 BOQ 与内部配置待跟进":generatedDemo?"核对演示采购与费用假设":"外购询价与成本依据待跟进",question:isF8?"请核对客户 BOQ 原表行号、内部配置对应项、数量及拆分合并依据；未确认的映射保持待补。":generatedDemo?"服务器、网关、流量计采用虚构采购回价；差旅、物流及资金成本采用演示假设。请核对展示口径后继续。":"核对产品或物料的配置、数量、物料号与采购回价；缺少的项目保留待跟进。此演示不会向采购发出询价。",status:"open",createdAt:new Date().toISOString(),draft:completedAnswer,conversationId,demoScenario:generatedDemo};
    const gateTitle=isF8?(/报价/.test(title)?"确认报价依据":"确认客户 BOQ 与内部清单"):generatedDemo?(title==="报价表"?"核对演示定价规则":"查看模拟 CRM 数据"):(title==="报价表"?"说明销售定价原则":"外部系统取数提示");
    const gateQuestion=isF8?(/报价/.test(title)?"请确认客户 BOQ、内部成本依据和已批准的报价原则；缺失时保留待补。":"请确认客户 BOQ 原表与内部配置清单是否已上传；缺失时只能生成待补映射草稿。"):(generatedDemo?"以下 CRM 料号、价格和采购回价均为虚构演示数据；请确认演示口径后继续。":title==="报价表"?"请说明有依据的销售定价原则；暂时没有时可以保留待补并继续审核草稿。":"CRM 面价、采购记录与产品池需要外部系统连接。当前演示未接入这些系统，不会查询或虚构价格。");
    const gate:F7HumanTask={id:randomId(),kind:/报价/.test(title)?"pricing":"access",turnId:id,title:gateTitle,question:gateQuestion,status:"open",createdAt:new Date().toISOString(),draft:completedAnswer,conversationId,demoScenario:generatedDemo};
    setF7Tasks(rows=>[...(!skipFollowup&&isF8?[gate]:[]),...(needsFollowup?[followup]:[]),review,...rows]);if(isF8)openF7Human(skipFollowup?review:gate);
    if(collaboration){setF7Processed(rows=>rows.includes(collaboration.id)?rows:[...rows,collaboration.id]);if(collaboration.followupId)dispatch({type:"followupComplete",id:collaboration.followupId,projectId,result:`已形成${model?.configured?"":"模拟"}${title}草稿，等待人工审核。`});}
   }
  }catch(e){const stopped=controller.signal.aborted&&!timedOut;
   const message=timedOut?"模型超过 100 秒未返回新内容，请稍后重试。":e instanceof Error?e.message:"生成失败";
   setChatTurns(turns=>turns.map(t=>t.id===id?{...t,status:stopped?"stopped":"error",answer:t.answer+(stopped?"": "\n\n"+message),steps:t.steps.map(step=>step.state==="running"?{...step,state:"error",label:stopped?"已停止":message}:step)}:t));if(!stopped){setQuestion(q=>q||text);throw new Error(message);}}
  finally{clearTimeout(watchdog);streamController.current=null;if(!preflight){skillTrial.current=null;setTrialTask(null);}}
 }
 async function deleteCollaboration(message:CollaborationMessage){await localApi((!specialized||message.config_id?durableBase:base)+"/collaboration/"+message.id,{method:"DELETE"});await refresh();}
 async function readCollaboration(message:CollaborationMessage){await localApi((!specialized||message.config_id?durableBase:base)+"/collaboration/"+message.id+"/read",{method:"POST"});await refresh();}
 async function openHistorical(runId:string){
  const selected=await localApi<Run>(base+"/runs/"+runId);
  if(current)setChatTurns(turns=>turns.some(t=>t.id===current.id)?turns:[...turns,{id:current.id,runId:current.id,createdAt:current.created_at,question:runQuestion||"服务器规格方案",answer:current.narrative||current.preview||current.error||"",steps:[],status:current.status==="failed"?"error":"done"}]);
  setRestoredRun(selected);setRunQuestion((selected.inputs as Inputs&{change_note?:string}).change_note||"服务器规格方案");setShowServer(true);setStarted(true);setDrawer("server");
 }
 async function approveDraft(){
  if(!current)return;
  await localApi(base+"/runs/"+current.id+"/decision",json({action:"approve",note:note.trim()||"软件产品确认服务器规格方案",expected_revision:current.revision,expected_flow_revision:flow?.revision,option_index:optionIndex}));
  setChatNotice("已采纳，系统已通知解决方案。");await refresh();
 }
 async function mergeFromChat(){
  if(!flow||!current||!canMerge)throw new Error("请由解决方案岗位处理已采纳的方案");
  await localApi(base+"/workflow/merge",json({expected_revision:flow.revision,expected_run_revision:current.revision,note:"Agent 合入软件产品已审核采纳的服务器规格"}));
  setChatNotice("已将采纳的服务器规格合入完整设备清单，系统已通知软件产品。");setQuestion("");await refresh();
 }
 async function generateFromChat(){
  const source=showServer?current?.inputs??inputs:inputs;
  const sampling=generationPrompt.match(/(\d+)\s*秒/);
  const extra=generationPrompt.match(/(?:再?加|增加|新增|还有(?:大概|约)?|另有(?:大概|约)?)\s*(\d+(?:\.\d+)?)\s*(万|w)?\s*(?:个|的)?\s*测点/i);
  const baseline=current?.calculation.points??{low:source.point_low,high:source.point_high};
  const addition=extra?Number(extra[1])*(extra[2]?10000:1):0;
  const payload={...source,sample_ids:sampleIds,...(addition?{scope:"custom" as const,point_low:baseline.low+addition,point_high:baseline.high+addition}:{}),sampling_seconds:sampling?Number(sampling[1]):source.sampling_seconds,sampling_confirmed:true,scope_confirmed:true,assumptions_confirmed:true,
   scope_note:addition?`在原范围 ${baseline.low}–${baseline.high} 点上增加 ${addition} 点；新增设备数量待确认` :source.scope_note||"按现有三期机房及配套系统全量估算；DCOM 上送子集待确认；事件、波形暂未计入",change_note:generationPrompt,favorite_context:favoriteContext,conversation_context:conversationContext()};
  const created=await localApi<{id:string}>(base+"/runs",json(payload));
  if(showServer&&current)setChatTurns(turns=>turns.some(t=>t.id===current.id)?turns:[...turns,{id:current.id,runId:current.id,question:runQuestion||"生成服务器规格方案",answer:current.narrative||current.preview||current.error||"",steps:[],status:current.status==="failed"?"error":"done",createdAt:current.created_at}]);
  setRunQuestion(generationPrompt);setRestoredRun(await localApi<Run>(base+"/runs/"+created.id));setShowServer(true);setInputs(payload);setGenerationPrompt("");setQuestion("");setChatNotice("收到。我会核对资料、计算测点与存储，再生成一份供你审核的服务器规格方案。");await refresh();
 }
 async function send(){
  const text=question.trim()||(attachments.items.length?"请查看附件，先判断内容；需要补充时请询问我。":"");if(!text)return;setStarted(true);
  if(/^\d+(?:\.\d+)?$/.test(text)){
   setChatTurns(turns=>[...turns,{id:randomId(),createdAt:new Date().toISOString(),question:text,answer:`“${text}”指什么？是要调整测点数量、采样周期，还是选择某个方案？请补充单位或具体要求。`,steps:[],status:"done"}]);setQuestion("");return;
  }
  if(!specialized){
   if(isF7&&/成本/.test(text)&&/生成|准备|制作|配置/.test(text)&&!costPending){const cost=workspaceTasks.find(t=>t.id==="cost");if(cost){selectShortcut(cost);return;}}
   if(/调出|查看.*采纳|拿出/.test(text)){
    const all=await loadArtifacts();setArtifacts(all);const version=text.match(/(?:V|版本)\s*(\d+)/i);const chosen=all.find(a=>!version||a.revision===Number(version[1]));
    setChatTurns(t=>[...t,{id:randomId(),artifactId:chosen?.id,artifactTitle:chosen?.title,question:text,answer:chosen?.content||"没有找到对应的已采纳成果。",steps:[],status:"done",createdAt:new Date().toISOString()}]);setQuestion("");return;
   }
   await act(()=>streamReply(text));return;
  }
  if(/调出来|调出|拿出来|查看.*采纳|查看.*澄清表|查看.*偏离表/.test(text)){
   const all=await loadArtifacts();setArtifacts(all);
   const kind=/澄清/.test(text)?"澄清":/偏离/.test(text)?"偏离":/需求|核对/.test(text)?"核对":"";
   const version=text.match(/(?:V|版本)\s*(\d+)/i);
   const chosen=all.find(a=>(!kind||a.title.includes(kind))&&(!version||a.revision===Number(version[1])));
   setChatTurns(turns=>[...turns,{id:randomId(),artifactId:chosen?.id,artifactTitle:chosen?.title,createdAt:new Date().toISOString(),question:text,answer:chosen?chosen.content:"没有找到对应的已采纳成果，请告诉我是澄清表、偏离表还是需求核对结果。",steps:[],status:"done"}]);setQuestion("");return;
  }
  if(/推送|发送给解决方案|交给解决方案/.test(text)){
   setChatNotice(current?.status==="approved"?"采纳时系统已自动通知解决方案。":"请先选择候选方案并审核采纳，系统会自动通知解决方案。");setQuestion("");return;
  }
  if(/查看.*方案|继续.*方案/.test(text)&&current){setShowServer(true);setQuestion("");setChatNotice("");return;}
  if(/审核通过|确认通过|方案通过/.test(text)&&current?.status==="review"){
   await act(approveDraft);setQuestion("");return;
  }
  if(/服务器|测点|采样|存储/.test(text)&&/生成|修改|调整|重新|改成|改为|增加|新增|再加/.test(text)||showServer&&!chatTurns.at(-1)?.artifactTitle&&/修改|调整|重新|改成|改为|部署|本地|改一下/.test(text)&&!/澄清|偏离|应答/.test(text)){
   if(!canEdit){setChatNotice("服务器规格由软件产品生成和审核。");return;}
   if(!flow||flow.status==="waiting_equipment"){setChatNotice("还未收到解决方案交付的清单。请先完成清单交接。");return;}
   if(!/修改|调整|重算|重新|改成|改为|增加|新增|再加|新版本|新方案/.test(text)){
    await act(async()=>{
     const existing=await localApi<Run|null>(base+"/matching-run");
     if(existing){
      const selected=existing.selected_option||existing.draft?.options[existing.draft.recommended_index]?.name||"服务器规格方案";
      setChatTurns(turns=>[...turns,{id:randomId(),runId:existing.id,createdAt:new Date().toISOString(),question:text,answer:`已有与当前清单 **V${flow.equipment_revision}** 对应的服务器规格方案 **V${existing.revision}**。\n\n当前${existing.status==="approved"?"已采纳":"推荐"}方案：**${selected}**。\n\n你可以查看现有方案，或告诉我需要修改什么，我再生成新版本。`,steps:[],status:"done"}]);setQuestion("");
     }else{setGenerationPrompt(text);setChatNotice("");setQuestion("");}
    });return;
   }
   setGenerationPrompt(text);setChatNotice("");setQuestion("");return;
  }
  if(/合并.*清单|更新.*清单|合入.*清单/.test(text)){await act(mergeFromChat);return;}
  await act(()=>streamReply(text));
 }
 async function downloadScheme(format:string){
  if(!current)return;const response=await fetch(localApiBase+base+"/runs/"+current.id+"/export?format="+format,{headers:{Authorization:"Bearer "+sessionStorage.getItem("presales-local-api-token")}});
  if(!response.ok)throw new Error("方案导出失败，请确认已采纳此版本");
  const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");a.href=url;a.download=`${projectId}_服务器规格_V${current.revision}.${format}`;a.click();URL.revokeObjectURL(url);
 }
 async function downloadMerged(){
  const response=await fetch(localApiBase+base+"/workflow/merged-file",{headers:{Authorization:"Bearer "+sessionStorage.getItem("presales-local-api-token")}});
  if(!response.ok)throw new Error("清单下载失败");
  const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download=flow?.merged_file||"GSA02.xlsx";a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 const timeline: {id:string;at:string;kind:"turn"|"scheme"|"pending"|"notice";turn?:ChatTurn}[]=[
 ...chatTurns.filter(t=>!(showServer&&t.id===current?.id)).map((turn,i)=>({id:turn.id,kind:"turn" as const,turn,at:turn.createdAt||audit.find(a=>{try{return a.action==="ask"&&JSON.parse(a.detail).question===turn.question;}catch{return false;}})?.created_at||runs.find(r=>r.id===turn.id)?.created_at||new Date(i).toISOString()})),
 ...(showServer&&current?[{id:"scheme:"+current.id,kind:"scheme" as const,at:current.created_at}]:[]),
 ...(generationPrompt?[{id:"pending",kind:"pending" as const,at:pendingAt}]:[]),
 ...(chatNotice?[{id:"notice",kind:"notice" as const,at:chatNotice.startsWith("收到。我会")&&current?new Date(Date.parse(current.created_at)-1).toISOString():noticeAt}]:[])].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const costTask=trialTask||workspaceTasks.find(t=>t.id===roleTaskId)||workspaceTasks.find(t=>t.steps.some(s=>s.enabled&&s.capability==='cost'));
 function parameterField(p:FlowTask['parameters'][number]){return <label key={p.key}>{p.label}{p.unit?'（'+p.unit+'）':''}<input type={p.type==='text'?'text':'number'} min={p.min??undefined} max={p.max??undefined} step="any" value={costParameters?.[p.key]??p.default} onChange={e=>setCostParameters(v=>({...v,[p.key]:p.type==='text'?e.target.value:Number(e.target.value)}))}/></label>;}
 return <section className={"gsa-chat "+(!started?"gsa-home ":"")+(isSales?"gsa-f7":"")}>
  <header className="gsa-chat-header"><div className="gsa-agent-title"><i><Sparkles size={18}/></i><div><strong>{isF8?"BOQ 映射与报价 Agent":isF7?"成本与报价 Agent":specialized?(state.role==="解决方案"?"解决方案 Agent":"软件 Agent"):(stageId==="F5"?"软件 Agent":(stage?.title||stageId)+" Agent")}</strong><span>{isSales?state.role:canMerge?"解决方案":"软件支持"} · {projectId}</span></div></div>
   <nav>
    {started&&<button disabled={busy} onClick={()=>{setSampleIds([]);setRoleTaskId(null);setConversationId(randomId());setStarted(false);setCostPending(false);skillTrial.current=null;setTrialTask(null);setFavoriteContext("");setF7Tasks(rows=>rows.map(task=>({...task,draft:task.draft||chatTurns.find(turn=>turn.id===task.turnId)?.answer||""})));setChatTurns([]);setRunQuestion("");setShowServer(false);setRestoredRun(null);setGenerationPrompt("");setChatNotice("");setQuestion("");baselineAudit.current=new Set(audit.map(a=>a.id));}}>新对话</button>}
    {<button data-tour="skill" disabled={!storageReady||!salesFlow||busy} onClick={()=>setDrawer("flows")}>Skill</button>}
    <button onClick={()=>setDrawer("favorites")}><Bookmark size={13}/> 收藏对话{favorites.length>0?" · "+favorites.length:""}</button>


    <button className="gsa-nav-with-badge" aria-label={isSales?`协作，${f7PendingCollaboration} 项待处理`:messages.some(message=>!message.is_read&&message.recipient===account)?"协作，有新交接":"协作"} onClick={()=>{setF7SelectedCollab(null);setDrawer("workflow");}}>协作{isSales?f7PendingCollaboration>0&&<span className="gsa-nav-badge" aria-hidden="true">{f7PendingCollaboration>99?"99+":f7PendingCollaboration}</span>:messages.some(message=>!message.is_read&&message.recipient===account)&&<i className="gsa-notification-dot"/>}</button>
   </nav>
  </header>
  {error&&<div className="gsa-chat-error" role="alert">{error}{(error.includes("请先登录")||error.includes("未登录")||error.includes("重新登录"))&&<button onClick={()=>{dispatch({type:"logout"});window.location.assign("/login");}}>重新登录</button>}<button onClick={()=>setError("")} aria-label="关闭错误"><X size={14}/></button></div>}
  {isSales&&model&&!model.configured&&<div className="gsa-f7-demo-banner" role="status"><strong>模拟模式 · 无需 Key</strong><span>{isF8?"可体验 BOQ 映射、客户报价草稿与逐项人工审核；未确认的映射和金额保持待补。":"已准备虚构 CRM 料号与价格，并按 V6 模板和明示假设计算。所有金额仅用于演示。"}</span></div>}

  <div className="gsa-transcript" ref={streamRef}>
   {!started&&<div className="gsa-welcome"><i><Sparkles size={25}/></i><h2>今天要做些什么？</h2><p>{isF8?"核对客户 BOQ 与内部配置，整理映射表和客户报价草稿。":isF7?"整理成本依据、生成成本表，或准备报价草稿。":"核对需求、整理澄清、起草应答，或一起处理软件方案。"}</p></div>}

   {timeline.map(item=><div className="gsa-conversation-turn" key={item.id}>
    {item.kind==="turn"&&item.turn&&<><div className="gsa-user-message">{item.turn.attachments?.map(file=>file.is_image?<SourceFigure key={file.id} src={`/api/documents/${file.id}/figures/1`} label={file.name}/>:<small className="chat-source-file" key={file.id}>{file.name}</small>)}{item.turn.question}</div>{item.turn.status==="running"?<div className="gsa-thinking" role="status"><Sparkles size={15}/><span>正在思考</span><i/><i/><i/></div>:item.turn.status!=="done"&&item.turn.steps.length>0&&<details className="gsa-execution"><summary>执行过程</summary>{item.turn.steps.map(step=><div key={step.label}>{step.state==="done"?<CheckCircle2 size={13}/>:step.state==="error"?<X size={13}/>:<LoaderCircle size={13} className="spin"/>}{step.label}</div>)}</details>}<AgentReply text={item.turn.answer} canSave={item.turn.status==="done"} favorited={favorites.some(f=>f.conversationId===conversationId)} onFavorite={()=>favoriteReply(item.id,item.turn!.answer,item.turn!.question)}>{isSales&&!item.turn.question.includes("资料摸排")&&item.turn.status==="done"&&item.turn.answer.includes("|")&&(isF8?<F8ReviewSummary kind={/报价|销售价|定价/.test(item.turn.question)?"quote":"mapping"} draft={item.turn.answer} generatedAt={item.at}/>:<F7ReviewSummary kind={/报价|销售价|标价/.test(item.turn.question)?"quote":"cost"} draft={item.turn.answer} generatedAt={item.at} demoScenario={item.turn.demoScenario}/>)}{isF7&&item.turn.status==="done"&&!item.turn.trial&&!item.turn.question.includes("资料摸排")&&<div className="gsa-review-card"><div className="gsa-review-icon"><FileText size={21}/></div><div><strong>成本表方案</strong><span>{item.turn.demoScenario?`CNY ${item.turn.demoScenario.totals.cost.toLocaleString("zh-CN",{minimumFractionDigits:2})}`:"待核对"}</span></div><button onClick={()=>{const task=f7Tasks.find(t=>t.turnId===item.turn!.id&&t.kind==="review");if(task)openF7Human(task);}}>查看成本表<ArrowRight size={15}/></button></div>}<MarkdownReply text={isF7&&item.turn.status==="done"&&item.turn.demoScenario?.demo_kind==="gsa-cost-v1"?(item.turn.answer.split("### Agent 核对说明")[1]||"已按清单、CRM 与参数重新计算。可查看成本表逐项核对，或继续对话修改。"):item.turn.answer}/>{(item.turn.runId||runs.some(r=>r.id===item.id))&&<button className="gsa-history-action" onClick={()=>void act(()=>openHistorical(item.turn!.runId||item.id))}>查看方案 · 可采纳或修改<ArrowRight size={14}/></button>}{item.turn.status==="done"&&!item.turn.trial&&item.turn.workflow?.review===true&&!/资料摸排|核对当前工作区已有输入/.test(item.turn.question)&&item.turn.answer&&!item.turn.runId&&(isSales||gapParts(item.turn.answer).length===0)&&<div className="gsa-output-adoption">{(()=>{const adopted=artifacts.find(a=>(a.source_id===item.turn!.id||a.id===item.turn!.artifactId)&&a.content===item.turn!.answer);const pending=f7Tasks.find(t=>t.turnId===item.turn!.id&&t.kind==="review"&&t.status==="open");return adopted?<><span>已采纳 · V{adopted.revision}</span><button onClick={()=>void act(()=>downloadOutput(adopted))}><Download size={14}/>下载</button><button onClick={()=>void act(()=>downloadOutput(adopted,"xlsx"))}>Excel</button>{!isSales&&<button onClick={()=>void act(()=>downloadOutput(adopted,"docx"))}>Word</button>}</>:isSales&&!item.turn!.question.includes("资料摸排")?<><button disabled={!pending||busy||(isF8&&!!(pending&&f7TaskBlocked(pending)))} onClick={()=>pending&&openF7Human(pending)}><FileText size={14}/>查看方案</button>{isF7&&pending&&<button disabled={busy} onClick={()=>void act(async()=>{await adoptOutput(item.turn!);setF7Tasks(rows=>rows.map(row=>row.id===pending.id?{...row,status:"done"}:row));})}><CheckCircle2 size={14}/>采纳方案</button>}</>:canReview?<button disabled={busy} onClick={()=>void act(()=>adoptOutput(item.turn!))}><CheckCircle2 size={14}/>采纳成果</button>:null;})()}</div>}{item.turn.status==="done"&&!item.turn.trial&&item.turn.workflow?.review===true&&gapParts(item.turn.answer).map(part=>{const adopted=artifacts.find(a=>a.content===part.content&&a.title===part.title);return <div className="gsa-output-adoption" key={part.title}><strong>{part.title}</strong>{adopted?<><span>已采纳 · V{adopted.revision}</span><button onClick={()=>void act(()=>downloadOutput(adopted,"docx"))}>Word</button><button onClick={()=>void act(()=>downloadOutput(adopted,"xlsx"))}>Excel</button></>:canReview&&<button disabled={busy} onClick={()=>void act(()=>adoptOutput({...item.turn!,answer:part.content,artifactTitle:part.title}))}>采纳此成果</button>}</div>;})}{isF7&&item.turn.status==="done"&&!item.turn.costPreflight&&!item.turn.question.includes('请先核对成本估算所需资料')&&/成本/.test(item.turn.artifactTitle||item.turn.question)&&<div className="gsa-actions"><button className="btn primary" disabled={busy} onClick={()=>{const turn=item.turn!;const existing=f7Tasks.find(t=>t.turnId===turn.id&&t.kind==='review');if(existing){openF7Human(existing);return;}const review:F7HumanTask={id:randomId(),kind:'review',turnId:turn.id,title:'核对成本表',question:turn.question,status:'open',createdAt:turn.createdAt||new Date().toISOString(),draft:turn.answer,conversationId,demoScenario:turn.demoScenario};setF7Tasks(rows=>[review,...rows]);openF7Human(review);}}>核对成本表</button></div>}{isF7&&!item.turn.trial&&item.turn.runtimeRunId&&['error','stopped'].includes(item.turn.status)&&<button className="btn secondary" disabled={busy} onClick={()=>void streamReply(item.turn!.question,undefined,false,undefined,!!item.turn!.costPreflight,item.turn!)}>重试</button>}{item.turn.status==="running"&&<span className="gsa-stream-cursor"/>}</AgentReply></>}
    {item.kind==="notice"&&<AgentReply text={chatNotice}/>}
    {item.kind==="scheme"&&runQuestion&&<div className="gsa-user-message">{runQuestion}</div>}
   {item.kind==="pending"&&<><div className="gsa-user-message">{generationPrompt}</div><AgentReply text=""><p>收到，使用设备清单 V{flow?.equipment_revision}。采样周期{generationPrompt.match(/(\d+)\s*秒/)?.[1]||(showServer?current?.inputs.sampling_seconds:inputs.sampling_seconds)||inputs.sampling_seconds} 秒、历史保留 {showServer?current?.inputs.retention_years||inputs.retention_years:inputs.retention_years} 年。接入范围按三期机房与配套系统全量估算，事件和波形暂未计入。</p>{(()=>{const match=generationPrompt.match(/(?:再?加|增加|新增|还有(?:大概|约)?|另有(?:大概|约)?)\s*(\d+(?:\.\d+)?)\s*(万|w)?\s*(?:个|的)?\s*测点/i);if(!match)return null;const added=Number(match[1])*(match[2]?10000:1);const points=current?.calculation.points??{low:inputs.point_low,high:inputs.point_high};return <p>新增 {fmt(added)} 测点，计算范围改为 {fmt(points.low+added)}–{fmt(points.high+added)} 点；设备数量保持原假设，需另行确认。</p>;})()}<div className="gsa-actions"><button className="btn primary" disabled={busy||running} onClick={()=>void act(generateFromChat)}>确认，{showServer?"重新生成":"生成方案"}</button><button className="btn secondary" onClick={()=>setDrawer("parameters")}>调整范围与参数</button></div></AgentReply></>}
   {item.kind==="scheme"&&current&&<div className="gsa-inline-draft">{!running&&<div className="gsa-review-card"><div className="gsa-review-icon"><FileText size={21}/></div><div><strong>服务器规格方案 <em>V{current.revision}</em></strong><span>{labels[current.status]||current.status}{current.error?" · "+current.error:""}</span></div><button disabled={running||!current.narrative} onClick={()=>setDrawer("server")}>{"查看方案"}<ArrowRight size={15}/></button></div>}
    {(current.equipment_revision!=null&&current.equipment_revision!==flow?.equipment_revision||current.source_hashes?.some(old=>{const latest=materials?.manifest.find(m=>m.id===old.id);return !!latest&&latest.sha256!==old.sha256;}))&&<p className="gsa-version-warning">该方案参考的资料版本非最新版本{current.equipment_revision?`（清单 V${current.equipment_revision}）`:"（历史版本未记录）"}，仍可采纳或继续修改。</p>}
    {!running&&current.calculation&&<div className="gsa-draft-facts"><span>{fmt(current.calculation.points.low)}–{fmt(current.calculation.points.high)} 测点</span><span>{current.inputs.sampling_seconds} 秒采样</span><span>{current.inputs.retention_years} 年保留</span></div>}
    {(current.narrative||current.preview)&&<div className="gsa-inline-content"><AgentReply canSave={!running} text={current.narrative||current.preview||""} favorited={favorites.some(f=>f.sourceId===current.id)} onFavorite={()=>favoriteReply(current.id,current.narrative||"","服务器规格方案")}><div className="gsa-narrative"><MarkdownReply text={current.narrative||current.preview||""}/>{running&&<span className="gsa-stream-cursor"/>}</div></AgentReply></div>}
    {current.status==="failed"&&canEdit&&<button className="btn secondary" onClick={()=>{setGenerationPrompt("请重新生成服务器规格方案");}}>重试</button>}
    {(["review","stale","rejected"].includes(current.status)||current.status==="approved"&&flow?.run_id!==current.id)&&current.draft&&canReview&&!running&&<div className="gsa-adoption"><div className="gsa-option-list">{current.draft.options.map((o,i)=><button className={optionIndex===i?"selected":""} key={i} aria-pressed={optionIndex===i} onClick={()=>setOptionIndex(i)}><CheckCircle2 size={16}/><span>{o.name}</span>{i===current.draft?.recommended_index&&<small>推荐</small>}</button>)}</div><button className="btn primary" disabled={busy} onClick={()=>void act(approveDraft)}>采纳方案<ArrowRight size={15}/></button></div>}


   </div>}
   {item.kind==="scheme"&&running&&<div><div className="gsa-execution"><details open><summary>正在生成服务器规格</summary><div><CheckCircle2 size={13}/>已读取清单与规格书</div><div><CheckCircle2 size={13}/>已计算测点与存储</div><div><LoaderCircle size={13} className="spin"/>{current.stage_message||"正在等待模型输出"} · 已等待 {Math.max(0,Math.floor((clock-Date.parse(current.created_at))/1000))} 秒</div></details></div></div>}
   </div>)}
  {costPending&&isF7&&<div className="gsa-cost-confirm"><AgentReply text=""><strong>成本估算表</strong><p>{(trialTask||workspaceTasks.find(t=>t.id===roleTaskId)||workspaceTasks.find(t=>t.steps.some(s=>s.enabled&&s.capability==="cost")))?.parameters.slice(0,4).map(p=>`${p.label} ${costParameters?.[p.key]??p.default}${p.unit}`).join(" · ")}</p><div className="gsa-actions"><button className="btn primary" disabled={busy} onClick={()=>void act(async()=>{setCostPending(false);await streamReply("请按已确认参数和解决方案最新配置清单生成内部成本表。");})}>生成成本表</button><button className="btn secondary" onClick={()=>setDrawer("costFlow")}>资料与参数</button></div></AgentReply></div>}
   {started&&showServer&&current?.status==="approved"&&<div className="gsa-output-adoption"><span>服务器规格已采纳 · V{current.revision}</span><button onClick={()=>void act(()=>downloadScheme("docx"))}>下载 Word</button><button onClick={()=>void act(()=>downloadScheme("xlsx"))}>下载 Excel</button></div>}
   {started&&flow?.status==="merged"&&<div className="gsa-chat-card"><strong>完整设备清单</strong><button onClick={()=>void act(downloadMerged)}><Download size={14}/>下载</button></div>}
  </div>

  <footer className="gsa-composer">


   {!started&&<div className="gsa-quick">{workspaceTasks.map(task=><button key={task.id} onClick={()=>selectShortcut(task)}>{task.name}</button>)}</div>}

   <form onSubmit={e=>{e.preventDefault();if(!attachments.uploading)void send();}}>{attachments.picker}{attachments.chips}<textarea onPaste={attachments.paste} aria-label={isF8?"与 BOQ 映射与报价 Agent 对话":isF7?"与成本与报价 Agent 对话":stageId==="F5"?"与软件 Agent 对话":"与"+(stage?.title||stageId)+" Agent 对话"} placeholder="告诉我你要做什么…" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(storageReady&&!busy&&!attachments.uploading&&!running&&(!specialized||materials))void send();}}} value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000}/><button type={streamController.current?"button":"submit"} aria-label={streamController.current?"停止生成":"发送"} onClick={()=>{if(streamController.current)streamController.current.abort();}} disabled={!streamController.current&&(!storageReady||busy||attachments.uploading||running||(specialized&&!materials)||(!question.trim()&&!attachments.items.length))}>{streamController.current?<X size={18}/>:<ArrowUp size={18}/>}</button>
   <div className="gsa-composer-meta">{attachments.button}{selectedPages.length>0&&<span className="gsa-attached-count">已选 {selectedPages.length} 页</span>}<select aria-label="当前模型" value={model?.model||"unconfigured"} disabled={busy||running}><option value={model?.model||"unconfigured"}>{model?.configured?(model.provider==="zhipu"?"智谱 · ":model.provider+" · ")+model.model:isSales?"模拟模式 · 无需 Key":"模型未配置"}</option></select>{busy&&<span>正在处理…</span>}</div></form>
  </footer>
  {!started&&favorites.length>0&&<div className="gsa-home-favorites">{favorites.slice(0,6).map(f=><div className="gsa-home-favorite" key={f.id}><button title={f.title} onClick={()=>void act(()=>restoreFavorite(f))}><i><MessageSquare size={19}/></i><span>{f.title}</span></button><button className="gsa-favorite-delete" aria-label={"删除收藏 "+f.title} onClick={()=>persistFavorites(favorites.filter(item=>item.id!==f.id))}><X size={13}/></button></div>)}</div>}
  {drawer&&<div className="gsa-drawer-backdrop" onClick={()=>setDrawer(null)}><aside className={"gsa-drawer"+(drawer==="flows"?" gsa-flow-drawer":"")+(drawer==="sources"?" gsa-materials-drawer":"")+(drawer==="f7Template"?" gsa-f7-template-drawer":"")+(drawer==="f7Human"?" gsa-f7-human-modal":"")} onClick={e=>e.stopPropagation()} role={drawer==="f7Human"||drawer==="flows"?"dialog":undefined} aria-modal={drawer==="f7Human"||drawer==="flows"?true:undefined} aria-label={isSales?`${stageId} 工作侧栏`:"软件工作侧栏"}>
   <header><h3>{{costFlow:"资料与参数",procurement:"采购询价清单",flows:"Skill",files:"文件样本",costParameters:"资料与参数",sources:"项目资料",parameters:"方案参数",server:"方案生成依据",workflow:"协作消息",favorites:"收藏对话",tracking:"跟进",f7Human:f7HumanTask?.title||"人工处理",f7Template:f7TemplateKind==="cost"?"成本表模板":f7TemplateKind==="mapping"?"BOQ 映射表模板":isF8?"客户报价表模板":"报价表模板"}[drawer]}</h3><button aria-label={drawer==="f7Template"&&f7TemplateReturn?"返回上一页":"关闭侧栏"} onClick={()=>setDrawer(drawer==="f7Template"?f7TemplateReturn:null)}><X size={18}/></button></header>
   <div className="gsa-drawer-body">
    {(drawer==="costFlow"||drawer==="costParameters"||drawer==="procurement")&&<F7CostFlow projectId={projectId} procurement={drawer==="procurement"} parameters={costTask?.parameters.map(parameterField)} onGenerate={()=>void act(async()=>{setDrawer(null);setCostPending(false);await streamReply("请核对当前已有输入和缺失项，按最新配置清单及采购回价生成成本估算表；缺失项留空并标为待补草稿。");})}/>}
    {drawer==="flows"&&<WorkflowStudio projectId={projectId} stageId={stageId} onChange={next=>setSalesFlow({...next,draft:next.draft&&JSON.stringify(next.draft.definition)!==JSON.stringify(next.active.definition)?next.draft:null})} onTrial={trial=>{setSalesFlow(v=>v?{...v,draft:{id:trial.draftId,definition:trial.definition}}:v);skillTrial.current=trial;setTrialTask(trial.task);setDrawer(null);selectShortcut(trial.task,trial);}}/>}

    {drawer==="f7Template"&&isSales&&(isF8?<F8TableTemplate kind={f7TemplateKind==="quote"?"quote":"mapping"} projectId={projectId} draft={f7TemplateDraft} generatedAt={f7TemplateAt}/>:<F7TableTemplate kind={f7TemplateKind==="quote"?"quote":"cost"} projectId={projectId} draft={f7TemplateDraft} generatedAt={f7TemplateAt} demoScenario={f7Demo}/>)}

    {drawer==="files"&&<><label>工作入口<select value={roleTaskId||"survey"} onChange={e=>{setRoleTaskId(e.target.value);setSampleIds([]);}}>{roleTasks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><FileSamples projectId={projectId} taskId={roleTaskId||"survey"} selected={sampleIds} onChange={setSampleIds}/></>}
    {drawer==="favorites"&&<>{favorites.length===0?<p className="gsa-muted">收藏的对话会显示在这里。</p>:favorites.map(f=><article className="gsa-favorite-row" key={f.id}><button onClick={()=>void act(()=>restoreFavorite(f))}><MessageSquare size={17}/><div><strong>{f.title}</strong><span>{f.text.slice(0,100)}</span></div><ArrowRight size={15}/></button><button aria-label={"删除收藏 "+f.title} title="取消收藏" onClick={()=>persistFavorites(favorites.filter(item=>item.id!==f.id))}><Trash2 size={15}/></button></article>)}</>}
    {drawer==="tracking"&&isSales&&<div className="gsa-f7-task-list">
     <div className="gsa-f7-task-counts"><strong>待跟进 {f7PendingFollowup.length}</strong><strong>待审核 {f7PendingReview.length}</strong></div>
     {f7Tasks.length===0&&<p className="gsa-muted">暂无跟进或审核任务。生成{isF8?"BOQ 映射表或客户报价表":"成本表或报价表"}后，需要人工处理的事项会出现在这里。</p>}
     {[...f7OpenTasks,...f7Tasks.filter(task=>task.status==="done")].map(task=><article className="gsa-f7-task" key={task.id}>
      <button className="gsa-f7-task-main" onClick={()=>setF7SelectedTracking(f7SelectedTracking===task.id?null:task.id)}><span><small>{task.kind==="review"?"审核":task.kind==="access"?"系统访问":task.kind==="pricing"?"销售输入":"跟进"} · {new Date(task.createdAt).toLocaleString("zh-CN")}</small><strong>{task.title}</strong></span><em>{task.status==="done"?"已处理":f7TaskBlocked(task)?"等待前一步":"待处理"}</em></button>
      {task.status==="done"&&<button className="gsa-f7-task-x" aria-label={`关闭任务 ${task.title}`} title="关闭任务" onClick={()=>{setF7Tasks(rows=>rows.filter(row=>row.id!==task.id));setF7SelectedTracking(null);}}><X size={14}/></button>}
      {f7SelectedTracking===task.id&&<div className="gsa-f7-task-detail"><p>{task.question}</p>{task.status==="open"&&<button className="btn primary" disabled={f7TaskBlocked(task)} onClick={()=>openF7Human(task)}>立即处理</button>}</div>}
     </article>)}
    </div>}
    {drawer==="f7Human"&&isSales&&f7HumanTask&&<div className="gsa-f7-human">
     <div className="gsa-f7-human-content">{f7HumanTask.kind!=="review"&&<><span className="gsa-f7-human-kicker">{f7HumanTask.demoScenario?"虚构数据 · 仅供演示":f7HumanTask.kind==="access"?"需要确认资料":"需要人工跟进"}</span><h4>{f7HumanTask.title}</h4><p>{isF8?f7HumanTask.kind==="access"?"请确认客户 BOQ 原表及内部配置清单是否已上传。缺失时，映射只显示待补。":f7HumanTask.kind==="pricing"?"请核对成本依据、币种和获批定价原则。未确认金额保留待补。":"请核对客户行号、内部对应项、数量及拆分合并依据；未确认项保留待跟进。":f7HumanTask.demoScenario?"这套 CRM 料号、采购回价和计算条件全是演示数据。确认展示口径后即可继续审核。":f7HumanTask.kind==="access"?"CRM 面价、采购记录和产品池当前未接入。继续后只使用本机已选择资料；未查到的价格仍待补。":f7HumanTask.kind==="pricing"?"请说明销售定价原则。没有已确认规则时，可保留待补并直接查看审核草稿。":"请核对配置、数量和采购回价。可以保留此事项待跟进，同时继续审核当前待补草稿。"}</p></>}
     {f7HumanTask.kind==="access"&&f7HumanTask.demoScenario&&<div className="gsa-f7-demo-crm"><strong>模拟 CRM · {f7HumanTask.demoScenario.project}</strong><p>以下料号与价格全部虚构。</p><div><table><thead><tr><th>料号</th><th>名称</th><th>数量</th><th>CRM 单价</th><th>演示成本单价</th></tr></thead><tbody>{f7HumanTask.demoScenario.crm.map(row=><tr key={row.sku}><td>{row.sku}</td><td>{row.name}</td><td>{row.qty}</td><td>{row.listUnit.toLocaleString("zh-CN")}</td><td>{row.costUnit.toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div></div>}
     {f7HumanTask.kind==="followup"&&<div className="gsa-f7-checklist"><strong>人工跟进清单</strong>{isF8?<><span>核对客户 BOQ 行号、描述和数量</span><span>核对内部配置及拆分合并规则</span><span>记录差异、依据和版本</span><small>未确认项继续待补。</small></>:f7HumanTask.demoScenario?<><span>外购采购回价为虚构样例</span><span>调试按 2.5 人月 × 35,000</span><span>税费和资金成本按演示假设</span><small>点击“采用演示假设”只推进模拟流程。</small></>:<><span>核对外购物料号和数量</span><span>与采购确认回价及有效期</span><span>记录来源；尚未确认的金额继续待补</span><small>演示不会实际发送询价。</small></>}</div>}
     {f7HumanTask.kind==="review"&&(f7HumanTask.demoScenario?.demo_kind==="gsa-cost-v1"?<CostReviewEditor key={f7HumanTask.turnId} base={base} sourceId={f7HumanTask.turnId} scenario={f7HumanTask.demoScenario} onSaved={v=>{const task={...f7HumanTask,id:randomId(),turnId:v.id,draft:v.answer,demoScenario:v.scenario,createdAt:v.created_at,status:"open" as const};setChatTurns(rows=>[...rows,{id:v.id,question:"按单元格修改重新计算成本表",answer:v.answer,steps:[],status:"done",createdAt:v.created_at,demoScenario:v.scenario}]);setF7Tasks(rows=>[task,...rows.map(r=>r.id===f7HumanTask.id?{...r,status:"done" as const}:r)]);setF7HumanId(task.id);}}/>:isF8?<F8TableTemplate kind={/报价|销售价|定价/.test(f7HumanTask.question)?"quote":"mapping"} projectId={projectId} draft={f7HumanTask.draft||chatTurns.find(turn=>turn.id===f7HumanTask.turnId)?.answer||""} generatedAt={f7HumanTask.createdAt}/>:<F7TableTemplate kind={/报价|销售价|标价/.test(f7HumanTask.question)?"quote":"cost"} projectId={projectId} draft={f7HumanTask.draft||chatTurns.find(turn=>turn.id===f7HumanTask.turnId)?.answer||""} generatedAt={f7HumanTask.createdAt} demoScenario={f7HumanTask.demoScenario||chatTurns.find(turn=>turn.id===f7HumanTask.turnId)?.demoScenario}/>)}
     {f7HumanTask.kind==="review"&&<details className="gsa-f7-review-draft"><summary>Agent 草稿与说明</summary><div className="gsa-f7-draft"><MarkdownReply text={f7HumanTask.draft||chatTurns.find(turn=>turn.id===f7HumanTask.turnId)?.answer||"原草稿未找到，请返回对话查看。"}/></div></details>}
     {(f7HumanTask.kind==="followup"||f7HumanTask.kind==="pricing")&&(f7HumanTask.demoScenario?<details className="gsa-f7-review-draft"><summary>查看模拟计算草稿</summary><div className="gsa-f7-draft"><MarkdownReply text={f7HumanTask.draft||"原草稿未找到"}/></div></details>:<div className="gsa-f7-draft"><MarkdownReply text={f7HumanTask.draft||chatTurns.find(turn=>turn.id===f7HumanTask.turnId)?.answer||"原草稿未找到，请返回对话查看。"}/></div>)}
     </div><div className="gsa-f7-human-footer">{f7HumanTask.kind!=="access"&&<label>{f7HumanTask.kind==="pricing"?"销售定价原则":f7HumanTask.kind==="followup"?"补充信息":"修改意见"}<textarea value={f7HumanInput} onChange={e=>setF7HumanInput(e.target.value)} placeholder={isF8?f7HumanTask.kind==="pricing"?"输入已确认的报价原则和依据…":f7HumanTask.kind==="followup"?"输入客户行号、内部对应项、数量差异和来源…":"说明要修改的项目和依据…":f7HumanTask.kind==="pricing"?"输入有依据的定价原则…":f7HumanTask.kind==="followup"?"输入已确认的价格、来源或条件…":"说明要修改的项目和依据…"}/></label>}
     <div className="gsa-f7-human-actions"><button className="btn secondary" disabled={busy} onClick={()=>{setDrawer(null);setF7SelectedTracking(f7HumanTask.id);}}>稍后处理</button>
      {f7HumanTask.kind==="access"&&<>{!f7HumanTask.demoScenario&&<button className="btn secondary" disabled>授权并查询 · 待接入</button>}<button className="btn primary" disabled={busy} onClick={()=>continueF7Gate(f7HumanTask)}>{f7HumanTask.demoScenario?"使用模拟 CRM 数据继续":"使用已有资料继续"}</button></>}
      {(f7HumanTask.kind==="followup"||f7HumanTask.kind==="pricing")&&<><button className="btn secondary" disabled={busy} onClick={()=>f7HumanTask.demoScenario?(f7HumanTask.kind==="followup"?acceptF7DemoFollowup(f7HumanTask):continueF7Gate(f7HumanTask)):f7HumanTask.kind==="followup"?deferF7Followup(f7HumanTask):continueF7Gate(f7HumanTask)}>{f7HumanTask.demoScenario?f7HumanTask.kind==="followup"?"采用演示假设，查看审核草稿":"采用演示定价，查看审核草稿":f7HumanTask.kind==="followup"?"保留待跟进，查看审核草稿":"暂缺规则，查看审核草稿"}</button><button className="btn primary" disabled={busy||!f7HumanInput.trim()} onClick={()=>void submitF7Human()}>提交并继续处理</button></>}
      {f7HumanTask.kind==="review"&&<><button className="btn secondary" disabled={busy||!f7HumanInput.trim()} onClick={()=>void submitF7Human()}>修改</button><button className="btn primary" disabled={busy||!!chatTurns.find(t=>t.id===f7HumanTask.turnId)?.trial} onClick={()=>void approveF7Draft()}>采纳</button></>}
     </div>
    </div></div>}
    {drawer==="sources"&&<SharedProjectMaterials onTemplate={isF7?()=>openF7Template("cost","sources"):isF8?()=>openF7Template("mapping","sources"):undefined} projectId={projectId} stageId={stageId} documents={documents} artifacts={artifacts} selectedUpstream={selectedUpstream} onUpstreamSelection={setSelectedUpstream} selectedPages={selectedPages} onSelection={setSelectedPages} onRefresh={()=>void load()} onAsk={text=>{setQuestion(text);setDrawer(null);}}/>}

    {drawer==="parameters"&&<><p className="gsa-muted">采样周期默认 60 秒，请确认或修改。</p>
     <fieldset disabled={!canEdit||busy||running}><legend>接入范围</legend>
      <select aria-label="测点估算口径" value={inputs.scope} onChange={e=>change({scope:e.target.value as Inputs["scope"],scope_confirmed:false})}>
       <option value="phases">分期经验估算 · 新增机房与配套系统</option><option value="schedule">软件点表 · BMS/EPMS 楼栋全量</option><option value="custom">人工确认的 DCOM 上送测点范围</option>
      </select>
      {inputs.scope==="phases"&&materials?.phases.map(p=><label className="gsa-phase" key={p.id}><input type="checkbox" checked={inputs.phase_ids.includes(p.id)} onChange={e=>change({phase_ids:e.target.checked?[...inputs.phase_ids,p.id]:inputs.phase_ids.filter(id=>id!==p.id),scope_confirmed:false})}/><span><strong>{p.name} · {p.mw} MW · {fmt(p.low)}–{fmt(p.high)} 点</strong><small>{p.range}</small></span></label>)}
      {inputs.scope==="custom"&&<div className="gsa-fields"><label>测点下限<input type="number" min={1} value={inputs.point_low} onChange={e=>change({point_low:Number(e.target.value),scope_confirmed:false})}/></label><label>测点上限<input type="number" min={inputs.point_low} value={inputs.point_high} onChange={e=>change({point_high:Number(e.target.value),scope_confirmed:false})}/></label></div>}
      <p className="gsa-muted">请确认全量预算或 DCOM 上送子集。</p>
      <textarea aria-label="接入范围确认说明" placeholder="接入范围与依据" value={inputs.scope_note} onChange={e=>change({scope_note:e.target.value,scope_confirmed:false})} maxLength={1000}/>
      <div className="gsa-fields">
       {([["sampling_seconds","采样周期（秒）"],["retention_years","历史保留（年）"],["device_count","接入设备数（估算）"],["cache_days","缓存累计/保留（天）"],["record_types","监测记录类型数"]] as const).map(([k,label])=><label key={k}>{label}<input type="number" min={k==="cache_days"||k==="device_count"?0:1} step="any" value={inputs[k]} onChange={e=>change({[k]:Number(e.target.value),...(k==="sampling_seconds"?{sampling_confirmed:false}:{assumptions_confirmed:false})})}/></label>)}
      </div>
      <details><summary>更多存储假设</summary><div className="gsa-fields">
       {([["events_per_device_day","事件数/设备/天"],["waveform_devices","出波形设备数"],["waveforms_per_device_day","波形条数/设备/天"],["backup_copies","完整备份副本数"],["raid_usable_ratio","RAID 可用比例"],["headroom","规划余量比例"]] as const).map(([k,label])=><label key={k}>{label}<input type="number" min={0} step="any" value={inputs[k]} onChange={e=>change({[k]:Number(e.target.value),assumptions_confirmed:false})}/></label>)}
      </div></details>
      <p className="gsa-muted">事件与波形默认 0 为暂未计入；缓存默认三年线性累计（1095 天）。如滚动清空，请修改保留天数。</p>
      <label className="gsa-check"><input type="checkbox" checked={inputs.sampling_confirmed} onChange={e=>change({sampling_confirmed:e.target.checked})}/>已确认采样周期为 {inputs.sampling_seconds} 秒</label>
      <label className="gsa-check"><input type="checkbox" checked={inputs.scope_confirmed} onChange={e=>change({scope_confirmed:e.target.checked})}/>已确认接入范围与估算口径</label>
      <label className="gsa-check"><input type="checkbox" checked={inputs.assumptions_confirmed} onChange={e=>change({assumptions_confirmed:e.target.checked})}/>已核对存储假设及暂未计入项</label>
     </fieldset>
     <div className="gsa-actions"><button className="btn secondary" disabled={!canEdit||busy||running||!confirmed||!materials} onClick={()=>void act(async()=>{setCalc(await localApi(base+"/calculate",json(inputs)));setDrawer("server");})}>计算规模与存储</button>
      <button className="btn primary" disabled={!canEdit||busy||running||!confirmed||!materials||!model?.configured||!flow||flow.status==="waiting_equipment"} onClick={()=>void act(async()=>{const created=await localApi<{id:string}>(base+"/runs",json({...inputs,conversation_context:conversationContext()}));if(showServer&&current)setChatTurns(turns=>[...turns,{id:current.id,runId:current.id,createdAt:current.created_at,question:runQuestion||"生成服务器规格方案",answer:current.narrative||current.preview||current.error||"",steps:[],status:current.status==="failed"?"error":"done"}]);setRestoredRun(await localApi<Run>(base+"/runs/"+created.id));setRunQuestion("按确认的参数生成服务器规格方案");setPendingPrompt("");setStarted(true);setShowServer(true);setDirty(false);setCalc(null);setDrawer(null);await refresh();})}>{running?<><LoaderCircle size={15}/>生成中</>:"生成服务器方案草稿"}</button></div>

    </>}
    {drawer==="server"&&<>
     {current&&<div className="gsa-review-summary"><span>{labels[current.status]}</span><strong>GSA02 · 服务器规格方案</strong><p>设备清单 V{flow?.equipment_revision} · {current.inputs.sampling_seconds} 秒采样 · {current.inputs.retention_years} 年保留</p></div>}
     {result&&<><h4>{fmt(result.points.low)}–{fmt(result.points.high)} 点</h4><p className="gsa-muted">{result.points.source}</p>{dirty&&!calc&&<p className="gsa-reminder">参数已修改，请重新计算。</p>}
      <table><thead><tr><th>指标</th><th>下限</th><th>上限</th></tr></thead><tbody>{([["samples_per_second","采样/秒"],["time_series_gb","时序库 GB"],["pg_gb","业务库 GB"],["cache_gb","缓存 GB"],["backup_gb","备份 GB"],["raw_data_gb","原始数据盘 GB"]] as const).map(([k,label])=><tr key={k}><td>{label}</td><td>{fmt(result.low[k])}</td><td>{fmt(result.high[k])}</td></tr>)}</tbody></table>
      <details><summary>计算边界</summary>{result.limitations.map(l=><p key={l}>{l}</p>)}</details></>}
     {current?.error&&<p className="gsa-error">{current.error}</p>}{current?.narrative&&<AgentReply text={current.narrative} favorited={favorites.some(f=>f.sourceId===current.id)} onFavorite={()=>favoriteReply(current.id,current.narrative||"","服务器规格方案")}><div className="gsa-narrative"><MarkdownReply text={current.narrative}/></div></AgentReply>}

     {current&&<details><summary>生成参数与执行过程</summary><p>读取已交接清单和 CMMS 摘录 → 测点范围估算 → 调用存储计算工具 → 模型生成候选方案 → 软件产品采纳。</p><p>设备数 {current.inputs.device_count}；缓存 {current.inputs.cache_days} 天；备份 {current.inputs.backup_copies} 份；RAID 可用比例 {current.inputs.raid_usable_ratio.toFixed(3)}；余量 {current.inputs.headroom*100}%。</p><p>{current.inputs.scope_note}</p></details>}
     {!canReview&&current?.status==="review"&&<p className="gsa-review-owner"><CheckCircle2 size={16}/>由软件产品审核采纳后，系统自动通知解决方案。</p>}

    </>}
    {drawer==="workflow"&&isSales&&<div className="gsa-f7-task-list">{f7Collaboration.length===0&&<p className="gsa-muted">暂无协作任务。</p>}{f7Collaboration.map(task=>{const processed=task.status!=="待处理"||f7Processed.includes(task.id);return <article className="gsa-f7-task" key={task.id}><button className="gsa-f7-task-main" onClick={()=>setF7SelectedCollab(f7SelectedCollab===task.id?null:task.id)}><span><small>{task.source}{task.at?" · "+new Date(task.at).toLocaleString("zh-CN"):""}</small><strong>{task.title}</strong></span><em>{processed?"已处理":"待处理"}</em></button>{processed&&<button className="gsa-f7-task-x" aria-label={"关闭任务 "+task.title} title="关闭任务" onClick={()=>setF7Hidden(rows=>[...rows,task.id])}><X size={14}/></button>}{f7SelectedCollab===task.id&&<div className="gsa-f7-task-detail"><p>{task.detail}</p>{!processed&&<button className="btn primary" disabled={busy||!storageReady} onClick={()=>{const request=`请根据这条协作任务开始处理：${task.title}。任务详情：${task.detail}。${isF8?"请整理客户 BOQ 映射或报价草稿，未确认的对应关系、数量和金额保留待补。":"请整理成本或报价草稿，缺少依据的金额留空并列出待确认事项。"}`;setStarted(true);setDrawer(null);if(isF7){setCostPending(false);setRoleTaskId("cost");const cost=workspaceTasks.find(t=>t.id==="cost");if(cost)selectShortcut(cost);const msg=messages.find(m=>"api:"+m.id===task.id);if(msg)void act(()=>readCollaboration(msg));}else void act(()=>streamReply(request.slice(0,1000),{id:task.id,followupId:task.followupId}));}}>立即处理</button>}</div>}</article>})}</div>}
    {drawer==="workflow"&&!isSales&&<div className="gsa-message-list">{messages.length===0&&<p className="gsa-muted">暂无协作消息</p>}{messages.map(message=><article className={"gsa-message "+(!message.is_read?"unread":"")} key={message.id}><button className="gsa-message-delete" aria-label="删除协作消息" title="删除消息" disabled={busy} onClick={()=>void act(()=>deleteCollaboration(message))}><X size={14}/></button><header><span>{{system:"系统",agent:"Agent",solution:"解决方案",software:"软件产品",pm:"项目负责人"}[message.sender]||message.sender}</span><time>{new Date(message.created_at).toLocaleString("zh-CN")}</time></header><strong>{message.title}</strong>{message.kind==="equipment"&&<span className={"gsa-processing-status "+(message.processed?"processed":"")}>{message.processed?"已处理":"未处理"}</span>}<p>{message.body}</p><button className="btn primary" disabled={busy} onClick={()=>void act(async()=>{await readCollaboration(message);if(message.kind==="equipment"&&specialized){setStarted(true);setGenerationPrompt("解决方案的配置清单已就绪，请生成服务器规格方案");setQuestion("");}else setQuestion(canMerge&&message.kind==="deliverable"?"请将已采纳的服务器规格合入设备清单":"请帮我处理这条协作事项："+message.title+"。"+message.body);setDrawer(null);})}>处理</button></article>)}</div>}

   </div>
  </aside></div>}
 </section>;
}
