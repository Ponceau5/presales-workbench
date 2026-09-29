import { useState } from 'react'
export function Milestones({ reference = false }: { reference?: boolean }) {
  const [view, setView] = useState('list')
  const rows = reference
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
  return (
    <section className="milestone-workspace">
      <header>
        <h2>项目里程碑</h2>
        <div>
          <button
            className={view === 'timeline' ? 'active' : ''}
            onClick={() => setView('timeline')}
          >
            时间轴
          </button>
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            清单
          </button>
        </div>
      </header>
      <div className={'milestone-grid ' + view}>
        <div className="milestone-grid-heading">
          <span>阶段 / 里程碑</span>
          <span>目标日期</span>
          <span>依据与状态</span>
        </div>
        {rows.map((r, i) => (
          <div className="milestone-grid-row" key={r.phase}>
            <span>
              <i>{String(i + 1).padStart(2, '0')}</i>
              <b>{r.phase}</b>
              <strong>{r.title}</strong>
            </span>
            <time>{r.date || '—'}</time>
            <span>
              <b>{r.state}</b>
              <small>{r.source}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
