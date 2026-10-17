import { demoMilestones } from '@/lib/projectDemoData'
import { useState } from 'react'
import { useWorkbench } from '@/state/workbench'
import { CalendarDays, ChevronDown, Diamond } from 'lucide-react'
export function Milestones({ reference = false }: { reference?: boolean }) {
  const [view, setView] = useState('gantt')
  const {state}=useWorkbench();
  const [selected,setSelected]=useState<string|null>(null)
  const fallbackRows = reference
    ? [
        {
          phase: '合同',
          title: '授标基准',
          date: '2026-07-24',
          state: '项目笔记记录',
          source: '项目笔记 · 2026.09.15',
        },
        {
          phase: 'Phase 1',
          title: 'RFS',
          date: '2026-11-06',
          state: '日期待核实',
          source: 'PTC / App 4 口径存在差异',
        },
        {
          phase: 'Phase 2',
          title: '分期交付',
          date: '',
          state: '待登记',
          source: '需核对合同附件与项目计划',
        },
        {
          phase: 'Phase 3',
          title: '分期交付',
          date: '',
          state: '待登记',
          source: '需核对合同附件与项目计划',
        },
        {
          phase: '整体',
          title: '暂定竣工',
          date: '2027-08-06',
          state: '日期待核实',
          source: '项目笔记 · 2026.09.15',
        },
      ]
    : [
        {
          phase: '投标',
          title: '提交截止',
          date: '',
          state: '待登记',
          source: '待正式招标文件',
        },
        {
          phase: '合同',
          title: '签约目标',
          date: '',
          state: '待登记',
          source: '待销售与商务确认',
        },
        {
          phase: '交付',
          title: '分期计划',
          date: '',
          state: '待登记',
          source: '待项目经理计划',
        },
      ]
  const rows=demoMilestones[state.currentProjectId] || fallbackRows.map(r=>({...r,lane:'项目计划',progress:0,owner:'待分配',summary:r.source,tone:'planned',deliverables:[]}));
  const active=rows.find(r=>r.phase===selected)||rows.find(r=>r.tone==='active')||rows[0];
  const dates = rows.filter(r=>r.date).map(r=>Date.parse(r.date+'T00:00:00Z'));
  const first = dates.length ? Math.min(...dates) : Date.now();
  const last = dates.length ? Math.max(...dates) : first;
  const start = Date.UTC(new Date(first).getUTCFullYear(),new Date(first).getUTCMonth(),1);
  const end = Date.UTC(new Date(last).getUTCFullYear(),new Date(last).getUTCMonth()+1,1);
  const months: {label:string;left:number}[]=[];
  for(let d=new Date(start);d.getTime()<end;d.setUTCMonth(d.getUTCMonth()+1)) months.push({label:`${d.getUTCFullYear()}.${String(d.getUTCMonth()+1).padStart(2,'0')}`,left:(d.getTime()-start)/(end-start)*100});
  return <section className="milestones-panel">
    <header className="milestones-toolbar"><h2>项目里程碑 <small className="demo-data-label">演示</small></h2><div className="milestone-legend"><span data-tone="done">已完成</span><span data-tone="active">进行中</span><span data-tone="risk">需关注</span><span data-tone="planned">未开始</span></div><div role="group" aria-label="里程碑视图"><button aria-pressed={view==='list'} onClick={()=>setView('list')}>列表</button><button aria-pressed={view==='gantt'} onClick={()=>setView('gantt')}>甘特图</button></div></header>
    <div className="milestones-scroll">
    {view==='list' ? <div className="linear-milestones"><div className="milestone-sequence">{rows.map(r=><button key={r.phase} className={selected===r.phase?'selected':''} onClick={()=>setSelected(selected===r.phase?null:r.phase)}><Diamond size={15}/><strong>{r.title}</strong><small>{r.phase}</small><time>{r.date||'日期待定'}</time></button>)}</div><div className="linear-milestone-list">{rows.map(r=><article key={r.phase} className={'linear-milestone '+(selected===r.phase?'selected':'')}><button className="linear-milestone-heading" aria-expanded={selected===r.phase} onClick={()=>setSelected(selected===r.phase?null:r.phase)}><ChevronDown size={14}/><Diamond size={16}/><span><strong>{r.title}</strong><small>{r.phase}</small></span><span className="milestone-status">{r.state}</span><time><CalendarDays size={13}/>{r.date||'日期待定'}</time></button>{selected===r.phase&&<div className="linear-milestone-body"><div><h3>依据</h3><p>{r.source}</p></div><dl><div><dt>阶段</dt><dd>{r.phase}</dd></div><div><dt>目标日期</dt><dd>{r.date||'待登记'}</dd></div><div><dt>核实状态</dt><dd>{r.state}</dd></div></dl></div>}</article>)}</div></div> : <div className="project-timeline-scroll"><div className="project-timeline">
      {active&&<div className="milestone-focus-card" data-tone={active.tone}><div><span className="milestone-tone-dot"/><strong>{active.title}</strong><span>{active.state}</span><time>{active.date}</time></div><p>{active.summary}</p><div className="milestone-progress"><span style={{width:active.progress+'%'}}/></div><footer><span>{active.owner} · {active.progress}%</span><span>{active.deliverables.join(' · ')}</span></footer></div>}

      <div className="project-timeline-calendar">{months.map(m=><span key={m.label} style={{left:m.left+'%'}}>{m.label}</span>)}</div>
      {[...new Set(rows.map(r=>r.lane))].map(lane=>{const laneRows=rows.filter(r=>r.lane===lane&&r.date);const points=laneRows.map(r=>Date.parse(r.date+'T00:00:00Z'));return <div className="project-timeline-lane" key={lane}><h3>{lane}</h3><div className="project-timeline-track">{months.map(m=><i key={m.label} style={{left:m.left+'%'}}/>)}{points.length>0&&<div className="project-date-band" style={{left:((Math.min(...points)-start)/(end-start)*100)+'%',width:Math.max((Math.max(...points)-Math.min(...points))/(end-start)*100,2)+'%'}}/>}{laneRows.map((r,index)=>{const pos=(Date.parse(r.date+'T00:00:00Z')-start)/(end-start)*100;return <button data-label-row={index%3} data-tone={r.tone} className={'timeline-milestone '+(active?.phase===r.phase?'selected':'')} style={{left:pos+'%'}} key={r.phase} onClick={()=>setSelected(r.phase)} aria-label={`${r.title}，${r.date}`}><Diamond size={18}/><span className="timeline-marker-label">{r.title}<small>{r.date.slice(5)} · {r.progress}%</small></span><span className={'timeline-popover '+(pos>70?'align-end':'')}><strong><Diamond size={15}/>{r.title}</strong><span>{r.state} · {r.progress}% · {r.date}</span><span>{r.owner}</span><small>{r.summary}</small></span></button>})}</div></div>})}

      {rows.some(r=>!r.date)&&<div className="timeline-pending"><span>日期待定</span>{rows.filter(r=>!r.date).map(r=><span key={r.phase}><Diamond size={12}/>{r.phase} · {r.title}</span>)}</div>}
    </div></div>}
    </div>
  </section>
}
