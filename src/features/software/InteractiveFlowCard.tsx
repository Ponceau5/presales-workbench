import {FloatingNotice} from "@/components/FloatingNotice";
import {useEffect,useState,useRef} from "react";
import {localApi,localApiBase} from "@/lib/localApi";
import type {FlowTask} from "./WorkflowStudio";
import type {InteractionFlow,InteractionNode} from "@/lib/skillLearning";
import type {F7DemoScenario} from "./F7TableTemplate";
import {MarkdownReply} from "./MarkdownReply";
type Document={id:string;title:string;version:string};
type Row={sku:string;name:string;model:string;qty:number;category:string};
export type InteractionRun={id:string;revision:number;conversation_id:string;version:string;trial:boolean;draft_id?:string;task:FlowTask;flow:InteractionFlow;node:InteractionNode|null;status:string;parameters:Record<string,number|string>;completed:string[];skipped:string[];notice:string;turn_id?:string;artifact_id?:string;preview?:string;scenario?:F7DemoScenario|null;scope_confirmed?:boolean;parameters_confirmed?:boolean;readiness:{purchase_required:boolean;inputs:Record<string,{name:string;document:Document|null}>;documents:Document[];bom:Row[];missing:string[];matched:string[];enquiry_id:string|null;enquiry_revision:number;enquiry_stale:boolean}};
type Props={projectId:string;run:InteractionRun;onChange:(run:InteractionRun)=>void;onGenerate:(run:InteractionRun,request?:string)=>Promise<unknown>;onReview:(run:InteractionRun)=>void;onApply:()=>void;busy:boolean};
function InteractiveFlowCardContent({projectId,run,onChange,onGenerate,onReview,onApply,busy:externalBusy}:Props){
 const base=`/api/projects/${encodeURIComponent(projectId)}/workspaces/F7`;
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[parameters,setParameters]=useState(run.parameters),[scope,setScope]=useState(!!run.scope_confirmed),[open,setOpen]=useState(true),[slot,setSlot]=useState("equipment");
 const input=useRef<HTMLInputElement>(null),heading=useRef<HTMLButtonElement>(null);
 const node=run.node,working=busy||externalBusy||run.status==="generating",free=run.flow.navigation!=="guided";
 const index=run.flow.nodes.findIndex(n=>n.id===node?.id);
 useEffect(()=>{
  if(!open)return;
  const prior=document.activeElement;
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.stopPropagation();setOpen(false);}};
  heading.current?.focus();document.addEventListener("keydown",key);
  return()=>{document.removeEventListener("keydown",key);if(prior instanceof HTMLElement)prior.focus();};
 },[open]);
 async function action(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 async function reload(){const next=await localApi<InteractionRun>(base+"/interactions/"+run.id);onChange(next);return next;}
 async function navigate(id:string,saveParameters=false){
  const next=await localApi<InteractionRun>(base+"/interactions/"+run.id+"/navigate",{method:"POST",body:JSON.stringify({expected_revision:run.revision,node_id:id,...(saveParameters?{parameters}:{})})});
  onChange(next);setError("");return next;
 }
 async function advance(){await action(async()=>{onChange(await localApi<InteractionRun>(base+"/interactions/"+run.id+"/advance",{method:"POST",body:JSON.stringify({expected_revision:run.revision,node_id:node?.id,confirmed:true,parameters})}));});}
 async function skip(){await action(async()=>{onChange(await localApi<InteractionRun>(base+"/interactions/"+run.id+"/skip",{method:"POST",body:JSON.stringify({expected_revision:run.revision,node_id:node?.id})}));});}
 async function generate(){await action(async()=>{const next=await navigate(node!.id,true);setOpen(false);await onGenerate(next);await reload();});}
 async function download(url:string,name:string){const response=await fetch(localApiBase+url,{headers:{Authorization:"Bearer "+sessionStorage.getItem("presales-local-api-token")}});if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.detail||"下载失败");}const link=document.createElement("a"),object=URL.createObjectURL(await response.blob());link.href=object;link.download=name;link.click();URL.revokeObjectURL(object);}
 const fields=<div className="interaction-parameters">{run.task.parameters.map(p=><label key={p.key}><span>{p.label}{p.unit?" · "+p.unit:""}</span><input aria-label={p.label} type={p.type==="number"?"number":"text"} min={p.min??undefined} max={p.max??undefined} step="any" value={parameters[p.key]??""} disabled={working} onChange={e=>setParameters(v=>({...v,[p.key]:p.type==="number"&&e.target.value!==""?Number(e.target.value):e.target.value}))}/></label>)}</div>;
 function fileField(key:string){
  const data=run.readiness.inputs[key];if(!data)return null;
  return <label className="interaction-file" key={key}><span>{data.name}<small>{data.document?"已选择":"待补"}</small></span><select aria-label={data.name} disabled={working} value={data.document?.id||""} onChange={e=>void action(async()=>{await localApi(base+"/cost-flow/input",{method:"POST",body:JSON.stringify({slot:key,document_id:e.target.value})});await reload();})}><option value="" disabled>选择项目资料</option>{run.readiness.documents.map(d=><option key={d.id} value={d.id}>{d.title} · {d.version}</option>)}</select><button className="btn secondary" aria-label={"上传"+data.name} disabled={working} onClick={()=>{setSlot(key);input.current?.click();}}>上传</button></label>;
 }
 const canDefer=free&&node&&["inspect","parameters","procurement","upload"].includes(node.kind);
 const review=()=>{setOpen(false);onReview(run);};
 const body=<>
  {run.notice&&<p className="interaction-notice" role="status">{run.notice}</p>}
  {node?.instruction&&<p>{node.instruction}</p>}
  {node?.kind==="inspect"&&<>
   <p className="gsa-muted">核对本次供货配置和成本资料。未就绪的项目可稍后补充，金额保留待补。</p>
   <section className="interaction-group"><h4>其他岗位资料</h4>{["equipment","software"].map(fileField)}</section>
   <section className="interaction-group"><h4>外部成本资料</h4>{Object.keys(run.readiness.inputs).filter(k=>!["equipment","software"].includes(k)).map(fileField)}</section>
   <p className="interaction-notice">{run.readiness.bom.length?`已识别 ${run.readiness.bom.length} 行配置；采购回价已匹配 ${run.readiness.matched.length} 项，待核对 ${run.readiness.missing.length} 项。`:"当前未识别到可核算的配置明细，可继续查看成本表并保留待补。"}</p>
   <label className="interaction-confirm"><input type="checkbox" checked={scope} disabled={working} onChange={e=>setScope(e.target.checked)}/>已核对配置清单版本、数量和供货范围</label>
   <button className="btn primary" disabled={!scope||working} onClick={()=>void advance()}>确认资料并继续</button>
  </>}
  {node?.kind==="parameters"&&<><p className="gsa-muted">核对本次成本参数。也可先使用当前值生成待补草稿，之后再修改。</p>{fields}<button className="btn primary" disabled={working} onClick={()=>void advance()}>保存并确认参数</button></>}
  {node?.kind==="procurement"&&<><p>选择的配置明细可用于准备采购询价。缺少有效配置时可以暂留待补。</p><div className="interaction-bom"><table><thead><tr><th>料号</th><th>名称 / 型号</th><th>数量</th></tr></thead><tbody>{run.readiness.bom.map((r,i)=><tr key={i}><td>{r.sku||"待补"}</td><td>{r.name} / {r.model}</td><td>{r.qty}</td></tr>)}</tbody></table>{!run.readiness.bom.length&&<p className="gsa-muted">暂无可询价的配置明细。</p>}</div><div className="gsa-actions"><button className="btn secondary" disabled={working||!run.readiness.bom.length} onClick={()=>void action(async()=>{const result=await localApi<{id:string}>(base+"/cost-flow/enquiry",{method:"POST",body:JSON.stringify({rows:run.readiness.bom,expected_revision:run.readiness.enquiry_revision})});await reload();await download(base+"/cost-flow/enquiry/"+result.id+"/download","采购询价清单.xlsx");})}>导出采购询价单</button><button className="btn primary" disabled={working||!run.readiness.enquiry_id||run.readiness.enquiry_stale} onClick={()=>void advance()}>继续核对回价</button></div></>}
  {node?.kind==="upload"&&<><p>选择或上传采购回价。尚未匹配的项目可继续待补。</p>{fileField("purchase")}<p className="gsa-muted">已匹配 {run.readiness.matched.length} 项；待核对 {run.readiness.missing.length} 项。</p><button className="btn primary" disabled={working} onClick={()=>void advance()}>确认回价并继续</button></>}
  {node?.kind==="calculate"&&<><p>按已有资料和当前参数生成成本表，未确认项目和金额继续待补。</p><div className="gsa-actions"><button className="btn primary" disabled={working} onClick={()=>void generate()}>{working?"正在生成…":"生成成本草稿"}</button><button className="btn secondary" disabled={busy||externalBusy} onClick={()=>void action(reload)}>刷新任务状态</button></div></>}
  {node?.kind==="review"&&(run.preview?<><p>打开成本表逐项核对，可填写修改意见后重新生成，再由你决定是否采纳。</p>{run.trial?<><button className="btn secondary" disabled={working} onClick={review}>核对成本表</button><details><summary>查看试运行草稿</summary><MarkdownReply text={run.preview}/></details><button className="btn primary" disabled={working} onClick={()=>void advance()}>确认试运行效果</button></>:<button className="btn primary" disabled={working} onClick={review}>核对成本表</button>}</>:<><p className="gsa-muted">尚未生成草稿，可以先补充资料或进入生成步骤。</p><button className="btn primary" disabled={working} onClick={()=>void action(()=>navigate(run.flow.nodes.find(n=>n.kind==="calculate")!.id))}>前往生成草稿</button></>)}
  {node?.kind==="export"&&<>{run.artifact_id?<><p>下载已采纳的成本表，或返回审核查看。</p><button className="btn primary" disabled={working} onClick={()=>void action(()=>download(base+"/artifacts/"+run.artifact_id+"/download?format=xlsx","成本估算表.xlsx"))}>下载成本表 Excel</button></>:run.trial&&run.completed.includes(run.flow.nodes.find(n=>n.kind==="review")!.id)?<button className="btn primary" disabled={working} onClick={()=>{setOpen(false);onApply();}}>打开 Skill 并应用</button>:<p className="gsa-muted">尚无已采纳版本。可先生成、核对成本草稿，再下载采纳的成本表。</p>}</>}
  {!node&&<p className="gsa-muted">本次成本表已完成，可从上方切换查看资料和成果。</p>}
 </>;
 return <section className="interactive-flow-card" aria-label="成本估算交互流程">
  <header><div><strong>{run.task.name}{run.trial?" · 试运行":""}</strong><small>{run.status==="completed"?"已完成":node?.title}</small></div><div className="gsa-actions"><button className="btn secondary" disabled={busy||externalBusy} onClick={()=>setOpen(true)}>资料与参数</button>{run.preview&&<button className="btn primary" disabled={busy||externalBusy} onClick={review}>核对成本表</button>}</div></header>
  <p className="interaction-summary">{free?"可自由切换步骤；缺失资料先留待补。":"按流程完成确认后生成草稿。"} 可在对话中说明要修改的流程、顺序或确认方式。</p>
  {!open&&node?.kind==="parameters"&&node.presentation==="chat"&&body}
  {error&&!open&&<FloatingNotice role="alert" className="flow-error">{error}</FloatingNotice>}
  <input ref={input} hidden type="file" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void action(async()=>{const form=new FormData();form.append("file",file);form.append("title",run.readiness.inputs[slot].name+" · "+file.name);form.append("version",new Date().toISOString().slice(0,10));const doc=await localApi<{id:string}>(`/api/projects/${projectId}/documents`,{method:"POST",body:form});await localApi(base+"/cost-flow/input",{method:"POST",body:JSON.stringify({slot,document_id:doc.id})});await reload();});e.target.value="";}}/>
  {open&&<div className="interaction-modal-backdrop" onClick={()=>setOpen(false)}><section className="interaction-modal" role="dialog" aria-modal="true" aria-label="核对成本表" onClick={e=>e.stopPropagation()}><header><div><strong>核对成本表{run.trial?" · 试运行":""}</strong><small>{run.task.name}</small></div><button ref={heading} type="button" aria-label="关闭成本表核对" onClick={()=>setOpen(false)}>×</button></header>
   <nav className="interaction-progress" role="tablist" aria-label="成本流程步骤">{run.flow.nodes.map(n=><button key={n.id} role="tab" aria-selected={n.id===node?.id} disabled={working||(!free&&n.id!==node?.id&&!run.completed.includes(n.id))} data-current={n.id===node?.id} data-done={run.completed.includes(n.id)} onClick={()=>void action(()=>navigate(n.id))}>{n.title}{run.skipped.includes(n.id)?" · 待补":""}</button>)}</nav>
   <div className="interaction-modal-body" role="tabpanel" aria-label={node?.title||"成本表"}>{body}{error&&<FloatingNotice role="alert" className="flow-error">{error}</FloatingNotice>}</div>
   <footer><button className="btn secondary" onClick={()=>setOpen(false)}>稍后处理</button><div className="gsa-actions">{index>0&&<button className="btn secondary" disabled={working} onClick={()=>void action(()=>navigate(run.flow.nodes[index-1].id))}>上一步</button>}{canDefer&&<button className="btn secondary" disabled={working} onClick={()=>void skip()}>暂留待补，继续</button>}</div></footer>
  </section></div>}
 </section>;
}

export function InteractiveFlowCard(props:Props){return <InteractiveFlowCardContent key={props.run.id} {...props} />;}
