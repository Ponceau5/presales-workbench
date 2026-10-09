import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import templateSchema from '@/lib/costTemplateSchema.json'
import { fillCostTemplate } from '@/lib/costTemplateExport'
import { inventoryFor, routeFor, type CommercialState } from '@/lib/commercialWorkflow'
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
  const left = row.cells.filter(item => item.column < cell.column && typeof item.value === 'string' && !item.formula).at(-1)?.value
  const header = sheet.rows.find(item => item.number === 3 || item.number === 26)?.cells.find(item => item.column === cell.column)?.value
  return `${sheet.title} ${left || header || ''} ${cell.ref}`
}

function costSuggestions(state: CommercialState) {
  const entries: Record<string, number> = {}
  const map: Record<string,string> = {
    panelAssembly:'F18',factoryAcceptance:'F37',packaging:'F43',capital:'F47',fxReserve:'F48',
    travel:'F29',accommodation:'F30',design:'F33',visa:'F35',localization:'F42',
    clearance:'F38',freight:'F39',insurance:'F49',
  }
  for (const [id, cell] of Object.entries(map)) {
    const record = state.extraCosts[id]
    if (record?.status === 'confirmed' && record.amount !== null) entries[`1:${cell}`] = record.amount
  }
  const lines = inventoryFor(state.baseline)
  for (const [route, cell] of [['software','F27'],['construction','F16']] as const) {
    const subset = lines.filter(line => route === 'software' ? routeFor(line) === 'software' : line.kind === '施工材料')
    if (subset.length && subset.every(line => state.costs[line.id]?.status === 'confirmed' && state.costs[line.id].amount !== null)) {
      entries[`1:${cell}`] = subset.reduce((sum,line)=>sum + (state.costs[line.id].amount || 0) * line.quantity,0)
    }
  }
  return entries
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
  const sheet = sheets[active]
  const suggestions = useMemo(() => costSuggestions(state), [state])
  const values = state.templateEntries || {}
  const allInputCells = sheet.rows.flatMap(row=>row.cells.filter(cell=>cell.input))
  const filled = allInputCells.filter(cell=>{
    const value = values[`${active + 1}:${cell.ref}`] ?? (active === 4 ? '' : cell.value)
    return value !== null && value !== undefined && value !== ''
  }).length

  function setCell(ref: string, value: string | number) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) { onMessage('请填写有效的非负金额或比例。'); return }
    onUpdate({ templateEntries: { ...values, [`${active + 1}:${ref}`]: value } })
  }
  function addSuggestions() {
    const missing = Object.fromEntries(Object.entries(suggestions).filter(([key])=>values[key] === undefined || values[key] === ''))
    if (!Object.keys(missing).length) { onMessage('已确认成本的直接对应项都已带入模板。'); return }
    onUpdate({ templateEntries: { ...values, ...missing } })
    onMessage(`已将 ${Object.keys(missing).length} 项明确对应的人民币成本带入模板主表；其余分类请按项目实际情况核对填写。`)
  }
  async function exportWorkbook() {
    setExporting(true)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}overseas-cost-template.xlsx`)
      if (!response.ok) throw new Error('成本模板文件未加载')
      const base = new Uint8Array(await response.arrayBuffer())
      const filled = fillCostTemplate(base, { '1:A1': `${projectId}项目-评估模板`, ...values })
      const blob = new Blob([Uint8Array.from(filled)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${projectId}-海外成本估算模板-${state.baseline}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      onMessage('已按原模板的 7 个页签和单元格位置导出 Excel。公式将在 Excel 打开时重算；空白项仍需对应岗位填写。')
    } catch (error) { onMessage(error instanceof Error ? error.message : '成本模板导出失败') }
    finally { setExporting(false) }
  }

  function renderInput(row: { number: number; cells: TemplateCell[] }, cell: TemplateCell) {
    const key = `${active + 1}:${cell.ref}`
    const raw = values[key] ?? (active===0 && cell.ref==='A1' ? `${projectId}项目-评估模板` : cell.value ?? '')
    const disabled = !!cell.financeOnly && role !== '财务 / 风控'
    const label = cellLabel(sheet,row,cell)
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
    <div className="cw-card-head"><div><span className="cw-eyebrow">海外成本估算模板 V6 · 原表填写</span><h3>按模板逐页收集成本，直接输出同版式 Excel</h3></div><button className="cw-button primary" disabled={exporting} onClick={()=>void exportWorkbook()}><Download size={15}/>{exporting?'正在生成…':'导出原格式 Excel'}</button></div>
    <p className="cw-note">保留原表 7 个页签、说明、税率参考、单元格位置和公式。蓝框为需填项，灰底为原表说明或自动计算项。原表示例金额已清空；税率、税务口径和清关判断需由负责岗位复核。</p>
    <div className="cw-template-tools"><button className="cw-button" onClick={addSuggestions}><FileSpreadsheet size={15}/>带入已确认且明确对应的成本 · {Object.keys(suggestions).length} 项</button><span>模板主表成本单位：CNY · 对外报价币种在上方单独选择</span></div>
    <div className="cw-template-tabs" role="tablist" aria-label="海外成本模板页签">{sheets.map((item,index)=>{
      const fields = item.rows.flatMap(row=>row.cells.filter(cell=>cell.input))
      const done = fields.filter(cell=>{const value=values[`${index+1}:${cell.ref}`]??(index===4?'':cell.value);return value!==null&&value!==undefined&&value!==''}).length
      return <button key={item.name} role="tab" aria-selected={active===index} className={active===index?'active':''} onClick={()=>setActive(index)}><b>{item.name}</b><small>{index===4?`历史参数 · 本次修改 ${done} 项`:fields.length?`${done}/${fields.length} 项有值`:'原表参考'}</small></button>
    })}</div>
    <div className="cw-template-guide"><div><strong>{sheet.title}</strong><span>{sheet.owner}</span></div><p>{sheet.guide}</p>{sheet.name==='2.1 税费参数表（无需填写）'&&<p>本页只允许财务岗位修改。表内是模板留存的历史参数，不能直接视为当前适用税率。</p>}{sheet.name==='3. 清关成本测算表'&&<p>模板物料清单要求同一币种；若清单是外币，需先按已确认汇率折人民币，再汇入成本主表。</p>}<small>{active===4?`本次已修改 ${filled} 项历史参数；其余原值仍需财务复核。`:`本页 ${filled} / ${allInputCells.length} 个填写项有值；空白不代表 0。`}</small></div>
    <datalist id="cw-template-country">{choices.country.map(country=><option value={country} key={country}/>)}</datalist>
    <div className="cw-template-scroll"><table className="cw-template-table"><thead><tr><th>行</th>{Array.from({length:sheet.columns},(_,index)=><th key={index}>{alphabet[index]}</th>)}</tr></thead><tbody>{sheet.rows.map(row=>{
      const cells = new Map(row.cells.map(cell=>[cell.column,cell]))
      return <tr key={row.number}><th>{row.number}</th>{Array.from({length:sheet.columns},(_,index)=>{
        const cell = cells.get(index+1)
        if (!cell) return <td key={index}/>
        return <td key={index} className={cell.input?'cw-template-editable':cell.formula?'cw-template-formula':'cw-template-static'} title={cell.formula?'原表自动计算':undefined}>{cell.input ? renderInput(row,cell) : cell.formula ? <span>{active===0&&cell.ref==='F7'?'CNY（内部本位）':'自动计算'}</span> : typeof cell.value === 'string' && cell.value.length>180 ? <details><summary>{cell.value.slice(0,72)}…</summary><div>{cell.value}</div></details> : <span>{cell.value ?? ''}</span>}{cell.comment && <details className="cw-template-comment"><summary>原表批注</summary><div>{cell.comment}</div></details>}</td>
      })}</tr>
    })}</tbody></table></div>
    <p className="cw-note">页签中的原文包括业务提醒和历史税率参考，不替代本项目的财务、关务或商务确认。导出文件可继续在 Excel 中核对和打印，无需重新排版。</p>
  </section>
}
