import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router';
import {Plus,Search,Star,ArrowUpRight} from 'lucide-react';
import {toast} from 'sonner';
import {FloatingNotice} from '@/components/FloatingNotice';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {canCreateProject} from '@/lib/accounts';
import {localApi} from '@/lib/localApi';
import {randomId} from '@/lib/id';
import {roles,type Role} from '@/lib/workspace';
import {useWorkbench,type Project as WorkbenchProject} from '@/state/workbench';
import {projectFileCatalog} from '@/lib/projectFileCatalog';
import {projectChanges} from '@/lib/projectChanges';
import {rackIssues} from '@/lib/portfolio';
import ProjectDetail from '@/features/global-business/ProjectDetail';
import ProjectEditor from '@/features/global-business/ProjectEditor';
import {countryName,type BusinessRow,type BusinessData} from '@/features/global-business/types';
import './global-business.css';
import './projects.css';
const roleKeys:Record<Role,string>={销售:'sales',市场:'marketing',解决方案:'solution',硬件产品:'hardware',软件产品:'software',商务支持:'commercial','财务 / 风控':'finance',货运关务:'logistics',研发:'dev','认证 / 法务':'legal',系统管理员:'admin'};
const stageFromPortfolio:Record<string,string>={lead:'线索池',opportunity:'方案沟通',tender:'招标中',won:'已中标',delivery:'实施中',acceptance:'验收完毕',lost:'未中标'};
const stageColors:Record<string,string>={'线索池':'#64748b','前期接触':'#0d9488','方案沟通':'#0d9488','招标中':'#16a34a','已中标':'#8452dc','实施中':'#c77816','验收完毕':'#d54474','未中标':'#dc4444'};
const stageLane=(stage:string)=>stage==='线索池'?'MTL':['前期接触','方案沟通'].includes(stage)?'LTC·机会':stage==='招标中'?'LTC·投标':stage==='已中标'?'LTC·合同':stage==='实施中'?'LTC·交付':stage==='验收完毕'?'LTC·验收回款':'输单';
export default function Projects(){
 const {state,dispatch}=useWorkbench();const navigate=useNavigate();
 const [business,setBusiness]=useState<BusinessRow[]>([]),[businessError,setBusinessError]=useState('');
 const [query,setQuery]=useState('');
 const [onlyFollowed,setOnlyFollowed]=useState(false),[openedAt]=useState(()=>Date.now());
 const followKey=`presales-followed-projects:${state.accountId||'guest'}`;
 const [followed,setFollowed]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(followKey)||'[]');}catch{return [];}});
 const [detail,setDetail]=useState<WorkbenchProject|null>(null),[editing,setEditing]=useState(false);
 const [create,setCreate]=useState(false),[creating,setCreating]=useState(false),[createError,setCreateError]=useState(''),[name,setName]=useState(''),[owner,setOwner]=useState<Role>(state.role);
 const isAdmin=state.role==='系统管理员';
 async function loadBusiness(){try{const d=await localApi<BusinessData>('/api/global-business');setBusiness(d.projects);setBusinessError('');return d.projects;}catch(e){setBusinessError(e instanceof Error?e.message:'项目业务资料暂时无法读取');return null;}}
 useEffect(()=>{void loadBusiness();},[]);
 function dataFor(p:WorkbenchProject):BusinessRow{
  const linked=business.find(r=>r.workbench_project_id===p.id||'GB-'+r.id===p.id);if(linked)return {...linked,workbench_project_id:p.id};
  const f=p.portfolio;return {id:'',revision:0,name:p.name,country:f?({MY:'马来西亚',TH:'泰国',ID:'印度尼西亚'}[f.country]||f.country):'',region:f?.region||'',province:f?.park||'',owner:f?.owner||'',customer:f?.endUser||'',contractor:f?.contractor||'',consultant:f?.consultant||'',assignee:f?.pic||'',stage:f?stageFromPortfolio[f.stage]:'',mw:0,amount:null,currency:'CNY',bid_status:f?.bidStatus||'',follow_up:f?.timeline.map(t=>t.date+' '+t.text).join('\n')||'',products:{},delivery_stage:'待建立',progress:0,next_action:f?.notes||'',due_date:'',workbench_project_id:p.id,updated_at:p.updated};
 }
 function openDetail(p:WorkbenchProject,edit=false){setDetail(p);setEditing(edit);}
 function toggleFollow(id:string){const next=followed.includes(id)?followed.filter(x=>x!==id):[...followed,id];setFollowed(next);localStorage.setItem(followKey,JSON.stringify(next));}
 function updateTime(value:string){if(value==='刚刚')return openedAt;return Date.parse(/^\d{2}\.\d{2}$/.test(value)?`${new Date(openedAt).getFullYear()}-${value.replace('.','-')}`:value)||0;}
 async function save(fields:Record<string,unknown>){if(!detail)return;const row=dataFor(detail);const selectedId=detail.id;
  if(String(fields.name)!==detail.name){const existing=await localApi<{scope:string;owner_role:string}>('/api/access/projects/'+encodeURIComponent(selectedId));await localApi('/api/access/projects/'+encodeURIComponent(selectedId),{method:'PATCH',body:JSON.stringify({name:fields.name,scope:existing.scope,owner_role:existing.owner_role})});}
  await localApi('/api/global-business/projects/batch',{method:'POST',body:JSON.stringify({rows:[{id:row.id||undefined,revision:row.revision,fields:{...fields,workbench_project_id:selectedId}}]})});
  const refreshed=await loadBusiness();if(!refreshed)throw Error('修改已保存，但重新读取失败，请刷新确认');
  const f=detail.portfolio;const reverse=Object.fromEntries(Object.entries(stageFromPortfolio).map(([k,v])=>[v,k]));
  dispatch({type:'projectUpdate',id:selectedId,name:String(fields.name),owner:detail.owner,...(f?{portfolio:{...f,name:String(fields.name),country:({'马来西亚':'MY','泰国':'TH','印度尼西亚':'ID','印尼':'ID'}[String(fields.country)]||String(fields.country)),region:String(fields.region),park:String(fields.province),owner:String(fields.owner),endUser:String(fields.customer),contractor:String(fields.contractor),consultant:String(fields.consultant),pic:String(fields.assignee),stage:(reverse[String(fields.stage)]||'lead') as typeof f.stage,bidStatus:String(fields.bid_status),notes:String(fields.next_action),timeline:String(fields.follow_up).split('\n').filter(Boolean).map(text=>({date:new Date().toLocaleDateString('sv-SE'),text}))}}:{})});
  setDetail({...detail,name:String(fields.name)});setEditing(false);toast.success('项目资料已保存');
 }
 async function remove(p:WorkbenchProject){if(!window.confirm(`删除项目“${p.name}”？历史业务文件仍保留。`))return;try{await localApi('/api/access/projects/'+encodeURIComponent(p.id),{method:'DELETE'});dispatch({type:'projectDelete',id:p.id});if(detail?.id===p.id)setDetail(null);}catch(e){toast.error(e instanceof Error?e.message:'删除失败');}}
 const enriched=state.projects.map(project=>({project,row:dataFor(project)}));
 const filtered=enriched.filter(({project:p,row:r})=>(!onlyFollowed||followed.includes(p.id))&&[p.name,p.id,r.owner,r.assignee,r.customer].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>updateTime(b.project.updated)-updateTime(a.project.updated));
 return <div className="projects-page"><div className="portal-title page-titlebar"><h1>项目</h1>{canCreateProject(state.role)&&<button className="btn primary" onClick={()=>setCreate(true)}><Plus size={16}/>新建项目</button>}</div>
 <section data-tour="project-list" className="register-panel project-progress-register">
 <div className="project-toolbar"><div className="project-list-views"><button className={!onlyFollowed?'active':''} onClick={()=>setOnlyFollowed(false)}>全部项目</button><button className={onlyFollowed?'active':''} onClick={()=>setOnlyFollowed(true)}>我的关注</button></div><div className="library-search"><Search size={15}/><input aria-label="搜索项目" value={query} onChange={e=>setQuery(e.target.value)} placeholder="项目名称 / 编号 / 业主 / 负责人"/></div><span className="project-result-count">显示 {filtered.length} / {state.projects.length} 个项目</span></div>
 {businessError&&<p role="alert" className="project-profile-error">{businessError}<button className="btn" onClick={()=>void loadBusiness()}>重新读取</button></p>}
 <div className="dense-table-scroll"><table className="catalog-table project-register"><thead><tr>{['项目名称','国家/地区','大区','业主','负责人','规模','进展（MTL / LTC）','已写回环节','待复核变更','待处理','资料','更新','操作'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(({project:p,row:r})=>{const snap=p.id===state.currentProjectId?state:p.snapshot;const stage=String(r.stage||'阶段待登记');const files=state.resources.filter(x=>x.projectId===p.id).length+projectFileCatalog.filter(x=>x.projectId===p.id&&!state.resources.some(y=>y.path===x.path)).length;return <tr key={p.id} onClick={()=>openDetail(p)} tabIndex={0} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(p);}}} aria-label={'查看项目 '+p.name}>
 <td><div className="project-name-cell"><button className="project-follow" aria-label={(followed.includes(p.id)?'取消关注 ':'关注 ')+p.name} aria-pressed={followed.includes(p.id)} onClick={e=>{e.stopPropagation();toggleFollow(p.id);}}><Star size={15} fill={followed.includes(p.id)?'currentColor':'none'}/></button><button className="file-open" onClick={e=>{e.stopPropagation();openDetail(p);}}>{p.name.replace(' · RCJM1','')}<small>{p.id}</small></button></div></td>
 <td>{countryName(String(r.country||''))}</td><td>{String(r.region||'—')}</td><td>{String(r.owner||'—')}</td><td>{String(r.assignee||'—')}</td><td>{Number(r.mw)>0?String(r.mw)+' MW':'—'}</td><td><span className="project-business-stage" style={{'--stage-color':stageColors[stage]||'#64748b'} as React.CSSProperties}><i/>{stage}<small>{r.stage?stageLane(stage):''}</small></span></td><td>{Object.values(snap?.stageStates||{}).filter(x=>x?.written).length} / 13</td><td>{projectChanges(state,p.id).filter(x=>!['已写回','已完成'].includes(x.status)).length}</td><td>{p.reference?rackIssues.length:state.followups.filter(x=>x.projectId===p.id&&x.status!=='done').length}</td><td>{files}</td><td>{p.updated||'—'}</td>
 <td><div className="project-row-actions" onClick={e=>e.stopPropagation()}><button onClick={()=>openDetail(p)}>详情</button>{isAdmin&&<button onClick={()=>openDetail(p,true)}>编辑</button>}<button disabled={state.running&&p.id!==state.currentProjectId} onClick={()=>{dispatch({type:'projectSwitch',id:p.id});navigate('/projects/'+p.id+'?view=flow');}}>工作区<ArrowUpRight size={12}/></button>{isAdmin&&<button className="danger" onClick={()=>void remove(p)}>删除</button>}</div></td></tr>;})}</tbody></table>{!filtered.length&&<p className="empty-state">没有符合条件的项目，请调整筛选条件。</p>}</div></section>
 <Dialog open={create} onOpenChange={setCreate}><DialogContent><DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>创建项目档案和独立工作区。</DialogDescription></DialogHeader><label className="form-label">项目名称<input value={name} onChange={e=>setName(e.target.value)}/></label><label className="form-label">协调岗位<select value={owner} onChange={e=>setOwner(e.target.value as Role)}>{roles.map(role=><option key={role}>{role}</option>)}</select></label><button className="btn primary" disabled={!name.trim()||state.running||creating} onClick={async()=>{if(creating)return;setCreating(true);setCreateError('');try{const id='DEMO-'+randomId().slice(0,6).toUpperCase();await localApi('/api/access/projects',{method:'POST',body:JSON.stringify({id,name:name.trim(),scope:'监控与软件集成',owner_role:roleKeys[owner]})});const person=await localApi('/api/me');sessionStorage.setItem('presales-person',JSON.stringify(person));dispatch({type:'projectCreate',createdId:id,name,owner});setCreate(false);setName('');}catch(e){setCreateError(e instanceof Error?e.message:'创建失败');}finally{setCreating(false);}}}>{creating?'正在创建…':'创建项目'}</button>{createError&&<FloatingNotice role="alert">{createError}</FloatingNotice>}</DialogContent></Dialog>
 {detail&&<Dialog open onOpenChange={open=>{if(!open){if(editing)return;setDetail(null);}}}><DialogContent className="gb-project-drawer" showCloseButton={false} onEscapeKeyDown={e=>{if(editing)e.preventDefault();}} onInteractOutside={e=>{if(editing)e.preventDefault();}}>{editing?<ProjectEditor embedded key={detail.id} row={dataFor(detail)} onClose={()=>setEditing(false)} onSave={save}/>:<ProjectDetail embedded row={dataFor(detail)} canEdit={isAdmin} onClose={()=>setDetail(null)} onEdit={()=>setEditing(true)} onCreate={()=>{dispatch({type:'projectSwitch',id:detail.id});navigate('/projects/'+detail.id+'?view=flow');}}/>}</DialogContent></Dialog>}
 </div>;
}
