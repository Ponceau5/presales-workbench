import {useState} from 'react';
import {localApi,localApiBase} from '@/lib/localApi';
import F7TableTemplate,{type F7DemoScenario} from './F7TableTemplate';
export function CostReviewEditor({base,sourceId,scenario,onSaved}:{base:string;sourceId:string;scenario:F7DemoScenario;onSaved:(v:{id:string;answer:string;scenario:F7DemoScenario;created_at:string})=>void}){
 const [cells,setCells]=useState<Record<string,string|number>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const preview={...scenario,templateInputs:{...scenario.templateInputs,...cells}};
 async function download(){
  if(Object.keys(cells).length){setError('请先保存修改');return;}
  const response=await fetch(localApiBase+base+'/cost-drafts/'+sourceId+'/download',{headers:{Authorization:'Bearer '+sessionStorage.getItem('presales-local-api-token')}});
  if(!response.ok)throw new Error('模板下载失败');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='GSA02_成本模板V6_草稿.xlsx';a.click();URL.revokeObjectURL(url);
 }
 return <section className="gsa-cost-editor"><F7TableTemplate kind="cost" projectId={scenario.project} demoScenario={preview} onCellEdit={(key,value)=>setCells(v=>({...v,[key]:value}))} onDownload={()=>void download().catch(e=>setError(e.message))}/><footer>{error&&<span role="alert">{error}</span>}<button className="btn primary" disabled={busy||!Object.keys(cells).length} onClick={()=>{setBusy(true);setError('');void localApi<{id:string;answer:string;scenario:F7DemoScenario;created_at:string}>(base+'/cost-template-revisions',{method:'POST',body:JSON.stringify({source_id:sourceId,cells})}).then(onSaved).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>保存</button></footer></section>;
}
