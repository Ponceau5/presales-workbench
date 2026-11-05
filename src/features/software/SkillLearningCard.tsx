import {FloatingNotice} from "@/components/FloatingNotice";
import {useEffect,useEffectEvent,useState} from "react";
import {localApi} from "@/lib/localApi";
import type {SkillProposal} from "@/lib/skillLearning";
export function SkillLearningCard({base,proposal,onChange,onOpen,onTrial}:{base:string;proposal:SkillProposal;onChange:(value:SkillProposal)=>void;onOpen:()=>void;onTrial?:()=>void}){
 const notifyChange=useEffectEvent(onChange);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true;void localApi<SkillProposal>(base+"/flows/learn/"+proposal.id).then(p=>{if(active&&p.status!==proposal.status)notifyChange(p);}).catch(()=>{});return()=>{active=false;};},[base,proposal.id,proposal.status]);
 async function decide(action:"confirm"|"discard"){
  setBusy(true);setError("");
  try{await localApi(base+"/flows/learn/"+proposal.id+"/"+action,{method:"POST"});onChange({...proposal,status:action==="confirm"?"confirmed":"discarded"});}
  catch(e){setError(e instanceof Error?e.message:"保存失败，请重试");}finally{setBusy(false);}
 }
 return <section className="skill-learning-card"><strong>{proposal.interaction?"修改":"更新"}「{proposal.task_name}」{proposal.interaction?"的交互流程与 Skill":"的 Skill"}</strong><p>{proposal.summary}</p>
 {proposal.interaction&&<ol className="interaction-progress">{proposal.interaction.nodes.map(n=><li key={n.id}>{n.title}{n.when==="missing_purchase"?"（缺回价时）":""}{n.kind==="parameters"?(n.presentation==="chat"?" · 聊天确认":" · 参数表单"):""}</li>)}</ol>}
 <details><summary>查看修改差异</summary><pre>{proposal.diff||"正文没有变化"}</pre></details>
 <details><summary>查看完整新正文</summary><pre>{proposal.markdown}</pre></details>
 {proposal.status==="pending"?<div className="gsa-actions"><button className="btn primary" disabled={busy} onClick={()=>void decide("confirm")}>{proposal.interaction?"确认保存流程草稿":"确认更新 Skill"}</button><button className="btn secondary" disabled={busy} onClick={()=>void decide("discard")}>取消</button></div>:
 proposal.status==="confirmed"?<><p>已更新你的 Skill 草稿。试运行后可应用到本项目。</p><button className="btn secondary" onClick={onOpen}>打开 Skill</button>{onTrial&&<button className="btn primary" onClick={onTrial}>试运行新交互流程</button>}</>:<p>已取消本次修改。</p>}
 {error&&<FloatingNotice role="alert">{error}</FloatingNotice>}</section>;
}
