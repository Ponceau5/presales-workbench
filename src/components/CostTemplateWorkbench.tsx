import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import templateSchema from '@/lib/costTemplateSchema.json'
import { fillCostTemplate } from '@/lib/costTemplateExport'
import { costTemplatePrefill } from '@/lib/costTemplatePrefill'
import type { CommercialState } from '@/lib/commercialWorkflow'
import type { Role } from '@/lib/workspace'

type TemplateCell = { ref: string; column: number; value: string | number | null; formula?: boolean; input?: string; financeOnly?: boolean; comment?: string }
type TemplateSheet = { name: string; title: string; owner: string; guide: string; columns: number; rows: { number: number; cells: TemplateCell[] }[] }
const sheets = templateSchema.sheets as TemplateSheet[]
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const choices: Record<string, string[]> = {
  country: ['泰国','马来西亚','印度尼西亚','韩国','日本'],
  entity: ['中国公司','新加坡公司'],
  trade: ['FOB','CIF','DAP','DDU','DDP'],
  api: ['有','无'],
  clearance: ['正常清关','部分灰清','全部灰清'],
  clearanceOwner: ['货代公司','客户'],
  yesno: ['是','否'],
  currency: ['CNY','USD','EUR','HKD','THB','SGD','MYR','IDR','JPY','KRW','VND','BRL','AUD','GBP'],
}

function cellLabel(sheet: TemplateSheet, row: { number: number; cells: TemplateCell[] }, cell: TemplateCell) {
  if (sheet.name === '1 成本费用预估' && cell.column === 6) {
    const item = row.cells.find(entry => entry.ref === `C${row.number}`)?.value
    if (typeof item === 'string' && item.trim()) return `${item.trim()} ${cell.ref}`
  }
  const left = row.cells.filter(item => item.column < cell.column && typeof item.value === 'string' && !item.formula).at(-1)?.value
  const header = sheet.rows.find(item => item.number === 3 || item.number === 26)?.cells.find(item => item.column === cell.column)?.value
  return `${sheet.title} ${left || header || ''} ${cell.ref}`
}

export default function CostTemplateWorkbench({ state, role, projectId, onUpdate, onMessage }: {
  state: CommercialState
  role: Role
  projectId: string
  onUpdate: (patch: Partial<CommercialState>) => void
  onMessage: (message: string) => void
}) {
  const [active, setActive] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [showAllMissing, setShowAllMissing] = useState(false)
  const sheet = sheets[active]
  const auto = useMemo(() => costTemplatePrefill(state), [state])
  const values = state.templateEntries || {}
  const effective = (index: number, cell: TemplateCell) => {
    const key = `${index + 1}:${cell.ref}`
    const managed = auto.cells[key]
    if (managed?.total) return managed.value ?? ''
    return values[key] ?? (index === 0 && cell.ref === 'A1' ? `${projectId}项目-评估模板` : cell.value ?? '')
  }
  const allInputCells = sheet.rows.flatMap(row=>row.cells.filter(cell=>cell.input))
  const filled = allInputCells.filter(cell=>{
    const value = active === 4 ? values[`5:${cell.ref}`] ?? '' : effective(active, cell)
    return value !== null && value !== undefined && value !== ''
  }).length
  const missing = active === 4 ? [] : sheet.rows.flatMap(row=>row.cells.filter(cell=>cell.input && effective(active, cell) === '' && !auto.cells[`${active + 1}:${cell.ref}`]?.notApplicable).map(cell=>({row,cell})))
  const pendingCategories = Object.values(auto.cells).filter(cell=>cell.pending.length || cell.conflict).length
  const draft = pendingCategories > 0 || auto.unassigned.length > 0

  function setCell(ref: string, value: string | number) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) { onMessage('请填写有效的非负金额或比例。'); return }
    onUpdate({ templateEntries: { ...values, [`${active + 1}:${ref}`]: value } })
  }
  async function exportWorkbook() {
    setExporting(true)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}overseas-cost-template.xlsx`)
      if (!response.ok) throw new Error('成本模板文件未加载')
      const base = new Uint8Array(await response.arrayBuffer())
      const manual = Object.fromEntries(Object.entries(values).filter(([key])=>!auto.cells[key]?.total))
      const automatic = Object.fromEntries(Object.entries(auto.cells).filter(([,cell])=>cell.value !== null).map(([key,cell])=>[key,cell.value!]))
      const filled = fillCostTemplate(base, { '1:A1': `${projectId}项目-评估模板`, ...manual, ...automatic })
      const blob = new Blob([Uint8Array.from(filled)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${projectId}-海外成本估算模板-${state.baseline}${draft?'-待补草稿':''}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      onMessage(`已导出原格式 Excel；自动带入 ${Object.keys(automatic).length} 项。当前仍有 ${pendingCategories} 个成本分类待补或核对、${auto.unassigned.length} 笔已确认成本待人工归类。空白项请继续补充，公式在 Excel 打开时重算。`)
    } catch (error) { onMessage(error instanceof Error ? error.message : '成本模板导出失败') }
    finally { setExporting(false) }
  }

  function renderInput(row: { number: number; cells: TemplateCell[] }, cell: TemplateCell) {
    const key = `${active + 1}:${cell.ref}`
    const raw = effective(active,cell)
    const managed = auto.cells[key]
    const disabled = !!cell.financeOnly && role !== '财务 / 风控'
    const label = cellLabel(sheet,row,cell)
    if (managed?.total) return <div className="cw-template-auto"><strong>{raw === '' ? managed.notApplicable ? '不适用' : '待岗位回填' : `CNY ${Number(raw).toLocaleString('zh-CN')}`}</strong><small>{managed.conflict ? '清单与补充费用重复，销售核对后处理' : managed.pending.length ? `已带入 ${managed.confirmed}/${managed.total} 笔；待确认 ${managed.pending.length} 笔` : '已随岗位确认自动更新'}</small></div>
    if (cell.input === 'country') return <input aria-label={label} disabled={disabled} list="cw-template-country" value={String(raw)} onChange={e=>setCell(cell.ref,e.target.value)} placeholder="选择或输入国家"/>
    if (choices[cell.input || '']) {
      const options = choices[cell.input!]
      const current = String(raw)
      return <select aria-label={label} disabled={disabled} value={current} onChange={e=>setCell(cell.ref,e.target.value)}>
        <option value="">请选择</option>{!options.includes(current) && current && <option value={current}>{current}</option>}{options.map(option=><option key={option} value={option}>{option}</option>)}
      </select>
    }
    if (cell.input === 'number' || cell.input === 'percent') {
      const number = raw === '' ? '' : cell.input === 'percent' ? Number(raw) * 100 : Number(raw)
      return <span className="cw-template-number"><input aria-label={label} disabled={disabled} type="number" min="0" step="any" value={number} onChange={e=>setCell(cell.ref,e.target.value === '' ? '' : cell.input === 'percent' ? Number(e.target.value) / 100 : Number(e.target.value))}/>{cell.input === 'percent' && <small>%</small>}</span>
    }
    return <input aria-label={label} disabled={disabled} value={String(raw)} onChange={e=>setCell(cell.ref,e.target.value)} placeholder={cell.input === 'date' ? 'YYYY-MM-DD' : '填写实际情况'}/>
  }

  return <section className="cw-card cw-template-workbench">
    <div className="cw-card-head"><div><span className="cw-eyebrow">海外成本估算模板 V6 · 原表填写</span><h3>按模板逐页收集成本，直接输出同版式 Excel</h3></div><button className="cw-button primary" disabled={exporting} onClick={()=>void exportWorkbook()}><Download size={15}/>{exporting?'正在生成…':draft?'导出待补草稿 Excel':'导出原格式 Excel'}</button></div>
    <p className="cw-note">保留原表 7 个页签、说明、税率参考、单元格位置和公式。岗位确认的成本会实时汇入对应栏目；有歧义的费用留给销售核对。原表示例金额已清空，税率、税务口径和清关判断需由负责岗位复核。</p>
    <div className="cw-template-tools"><strong>自动带入 {Object.values(auto.cells).filter(cell=>cell.value!==null).length} 项</strong><span>待补或核对分类 {pendingCategories} 项 · 待人工归类 {auto.unassigned.length} 笔 · 模板主表单位 CNY</span>{draft&&<small>当前成本仍在收集，导出文件是草稿，不能直接用于定价确认。</small>}</div>
    {(pendingCategories > 0 || auto.unassigned.length > 0) && <div className="cw-template-attention"><strong>销售下一步</strong><p>返回上方岗位卡片，催齐未确认成本；收到后模板会自动更新。工时、税费和无法唯一对应的费用，请销售与岗位确认后填入相应明细页。</p>{pendingCategories>0&&<details><summary>{pendingCategories} 个成本分类仍待补或核对</summary><ul>{Object.entries(auto.cells).filter(([,cell])=>cell.pending.length||cell.conflict).map(([key,cell])=><li key={key}>主表 {key.split(':')[1]}：{cell.conflict?'清单与补充费用重复，需核对':`待确认 ${cell.pending.join('、')}`}</li>)}</ul></details>}{auto.unassigned.length > 0 && <details><summary>{auto.unassigned.length} 笔已确认成本需人工归类</summary><ul>{auto.unassigned.map((item,index)=><li key={index}>{item}</li>)}</ul></details>}</div>}
    <div className="cw-template-tabs" role="tablist" aria-label="海外成本模板页签">{sheets.map((item,index)=>{
      const fields = item.rows.flatMap(row=>row.cells.filter(cell=>cell.input))
      const done = fields.filter(cell=>{const value=index===4?values[`5:${cell.ref}`]??'':effective(index,cell);return value!==null&&value!==undefined&&value!==''}).length
      return <button key={item.name} role="tab" aria-selected={active===index} className={active===index?'active':''} onClick={()=>{setActive(index);setShowAllMissing(false)}}><b>{item.name}</b><small>{index===4?`历史参数 · 本次修改 ${done} 项`:fields.length?`${done}/${fields.length} 项有值`:'原表参考'}</small></button>
    })}</div>
    <div className="cw-template-guide"><div><strong>{sheet.title}</strong><span>{sheet.owner}</span></div><p>{sheet.guide}</p>{sheet.name==='2.1 税费参数表（无需填写）'&&<p>本页只允许财务岗位修改。表内是模板留存的历史参数，不能直接视为当前适用税率。</p>}{sheet.name==='3. 清关成本测算表'&&<p>模板物料清单要求同一币种；若清单是外币，需先按已确认汇率折人民币，再汇入成本主表。</p>}<small>{active===4?`本次已修改 ${filled} 项历史参数；其余原值仍需财务复核。`:`本页 ${filled} / ${allInputCells.length} 个填写项有值；空白不代表 0。`}</small></div>
    {missing.length>0 && <div className="cw-template-missing-list"><div><strong>本页仍有 {missing.length} 个空白可填项</strong><small>按项目适用范围补充；明细表的备用行无需全部填写。空白不代表 0。</small></div><div>{(showAllMissing?missing:missing.slice(0,8)).map(({row,cell})=><button key={cell.ref} onClick={()=>document.getElementById(`cw-template-${active}-${cell.ref}`)?.scrollIntoView({block:'center',behavior:'smooth'})}>{row.number} 行 · {cellLabel(sheet,row,cell)}</button>)}{missing.length>8&&<button onClick={()=>setShowAllMissing(value=>!value)}>{showAllMissing?'收起':`查看全部 ${missing.length} 项`}</button>}</div></div>}
    <datalist id="cw-template-country">{choices.country.map(country=><option value={country} key={country}/>)}</datalist>
    <div className="cw-template-scroll"><table className="cw-template-table"><thead><tr><th>行</th>{Array.from({length:sheet.columns},(_,index)=><th key={index}>{alphabet[index]}</th>)}</tr></thead><tbody>{sheet.rows.map(row=>{
      const cells = new Map(row.cells.map(cell=>[cell.column,cell]))
      return <tr key={row.number}><th>{row.number}</th>{Array.from({length:sheet.columns},(_,index)=>{
        const cell = cells.get(index+1)
        if (!cell) return <td key={index}/>
        return <td key={index} id={`cw-template-${active}-${cell.ref}`} className={cell.input?effective(active,cell)===''?'cw-template-editable cw-template-empty':'cw-template-editable':cell.formula?'cw-template-formula':'cw-template-static'} title={cell.formula?'原表自动计算':undefined}>{cell.input ? renderInput(row,cell) : cell.formula ? <span>{active===0&&cell.ref==='F7'?'CNY（内部本位）':'自动计算'}</span> : typeof cell.value === 'string' && cell.value.length>180 ? <details><summary>{cell.value.slice(0,72)}…</summary><div>{cell.value}</div></details> : <span>{cell.value ?? ''}</span>}{cell.comment && <details className="cw-template-comment"><summary>原表批注</summary><div>{cell.comment}</div></details>}</td>
      })}</tr>
    })}</tbody></table></div>
    <p className="cw-note">页签中的原文包括业务提醒和历史税率参考，不替代本项目的财务、关务或商务确认。导出文件可继续在 Excel 中核对和打印，无需重新排版。</p>
  </section>
}
