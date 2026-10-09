import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import templateSchema from '@/lib/costTemplateSchema.json'
import { fillCostTemplate } from '@/lib/costTemplateExport'
import { costTemplateCurrencyIssues, costTemplateInCurrency } from '@/lib/costTemplateCurrency'
import { costTemplatePrefill, templateCellForLine } from '@/lib/costTemplatePrefill'
import { costTemplateChecks } from '@/lib/costTemplateChecks'
import { templateFieldRoutes } from '@/lib/costTemplateFields'
import { inventoryFor, quoteRateReady, type CommercialState, type CostCurrency } from '@/lib/commercialWorkflow'
import type { Role } from '@/lib/workspace'

type TemplateCell = { ref: string; column: number; value: string | number | null; formula?: boolean; input?: string; financeOnly?: boolean; comment?: string }
type TemplateSheet = { name: string; title: string; owner: string; guide: string; columns: number; rows: { number: number; cells: TemplateCell[] }[] }
const sheets = templateSchema.sheets as TemplateSheet[]
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const categoryChoices = [
  ['F14','自产 PMC 成本'],['F16','施工材料'],['F17','施工服务'],['F20','服务器'],['F21','交换机与网关'],
  ['F22','控制柜（含 PLC）'],['F23','流量计'],['F24','ICT'],['F25','安防系统'],['F26','其他外购设备'],
  ['F27','软件成本'],['F33','设计费用'],['F44','其他费用'],
] as const
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

export default function CostTemplateWorkbench({ state, role, projectId, expectedQuoteCny, expectedCostCny, onUpdate, onMessage }: {
  state: CommercialState
  role: Role
  projectId: string
  expectedQuoteCny: number | null
  expectedCostCny: number | null
  onUpdate: (patch: Partial<CommercialState>) => void
  onMessage: (message: string) => void
}) {
  const [active, setActive] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [showAllMissing, setShowAllMissing] = useState(false)
  const sheet = sheets[active]
  const auto = useMemo(() => costTemplatePrefill(state), [state])
  const inventory = useMemo(() => inventoryFor(state.baseline), [state.baseline])
  const confirmedLines = inventory.filter(line=>state.costs[line.id]?.status==='confirmed'&&state.costs[line.id]?.amount!==null)
  const checks = useMemo(() => costTemplateChecks(state, expectedQuoteCny, expectedCostCny, auto.cells), [state, expectedQuoteCny, expectedCostCny, auto])
  const issues = checks.filter(check=>!check.ready)
  const values = state.templateEntries || {}
  const foreignIssues = costTemplateCurrencyIssues(values,state.quoteCurrency)
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
  const draft = pendingCategories > 0 || auto.unassigned.length > 0 || issues.length > 0

  function setCell(ref: string, value: string | number) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) { onMessage('请填写有效的非负金额或比例。'); return }
    onUpdate({ templateEntries: { ...values, [`${active + 1}:${ref}`]: value } })
  }
  function setCategory(lineId: string, ref: string) {
    const next = { ...(state.templateCategoryOverrides || {}) }
    if (ref) next[lineId] = `1:${ref}`
    else delete next[lineId]
    onUpdate({ templateCategoryOverrides: next })
  }
  async function exportWorkbook(currency: CostCurrency) {
    setExporting(true)
    try {
      if (currency !== 'CNY' && !quoteRateReady(state)) throw new Error('请先填写项目人民币折外币汇率及来源')
      const response = await fetch(`${import.meta.env.BASE_URL}overseas-cost-template.xlsx`)
      if (!response.ok) throw new Error('成本模板文件未加载')
      const base = new Uint8Array(await response.arrayBuffer())
      const manual = Object.fromEntries(Object.entries(values).filter(([key])=>!auto.cells[key]?.total))
      const automatic = Object.fromEntries(Object.entries(auto.cells).filter(([,cell])=>cell.value !== null).map(([key,cell])=>[key,cell.value!]))
      const separateTax = state.extraCosts.tax?.status==='confirmed' && state.extraCosts.tax.treatment==='separate'
      const title = currency === 'CNY' ? `${projectId}项目-评估模板` : `${projectId}项目-评估模板 · ${currency}；1 CNY = ${state.quoteFxFromCny} ${currency}；${state.quoteFxEvidence.trim().slice(0, 60)}`
      const inputs = costTemplateInCurrency({ '1:A1': title, ...manual, ...automatic, ...(separateTax ? {'1:F45':0} : {}) }, currency, currency === 'CNY' ? null : state.quoteFxFromCny)
      const filled = fillCostTemplate(base, inputs, currency === 'CNY' ? undefined : { laborRateFromCny: state.quoteFxFromCny! })
      const blob = new Blob([Uint8Array.from(filled)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${projectId}-海外成本版-${currency}-${state.baseline}${draft?'-待补草稿':''}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      onMessage(`已导出 ${currency} 原格式成本 Excel；自动带入 ${Object.keys(automatic).length} 项。仍有 ${pendingCategories} 个成本分类待补、${auto.unassigned.length} 笔待归类、${issues.length} 项金额或测算条件待核对。${separateTax?'税费按商务条件单列，主表成本 F45 记 0；税费测算页仍保留原公式。':''}公式在 Excel 打开时重算。`)
    } catch (error) { onMessage(error instanceof Error ? error.message : '成本模板导出失败') }
    finally { setExporting(false) }
  }

  function renderInput(row: { number: number; cells: TemplateCell[] }, cell: TemplateCell) {
    const key = `${active + 1}:${cell.ref}`
    const raw = effective(active,cell)
    const managed = auto.cells[key]
    const roleRoute = role === '软件产品' ? 'software' : role === 'PM / PO' ? 'project' : role === '货运关务' ? 'customs' : role === '财务 / 风控' ? 'finance' : role === '商务支持' ? 'purchase' : 'internal'
    const disabled = !!cell.financeOnly && role !== '财务 / 风控' || role !== '销售' && !templateFieldRoutes(active,cell.ref).includes(roleRoute)
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
    <div className="cw-card-head"><div><span className="cw-eyebrow">海外成本估算模板 V6 · 原表填写</span><h3>按模板逐页收集成本，导出人民币或项目外币版</h3></div><div className="cw-actions"><button className="cw-button primary" disabled={exporting} onClick={()=>void exportWorkbook('CNY')}><Download size={15}/>{exporting?'正在生成…':'导出成本版 · CNY Excel'}</button>{state.quoteCurrency!=='CNY'&&<button className="cw-button" disabled={exporting||!quoteRateReady(state)||foreignIssues.length>0} onClick={()=>void exportWorkbook(state.quoteCurrency)}><Download size={15}/>导出成本版 · {state.quoteCurrency} Excel</button>}</div></div>
    <p className="cw-note">{state.quoteCurrency==='CNY'?'如需外币版，请先在上方选择项目输出币种并填写汇率。':foreignIssues.length?foreignIssues[0]:quoteRateReady(state)?`外币版按 1 CNY = ${state.quoteFxFromCny} ${state.quoteCurrency} 换算；人民币版保留内部本位金额。`:'请先在上方填写项目汇率及来源，外币版导出才可用。'}{draft?' 当前有待补或待核项，导出文件会标为草稿。':''}</p>
    <p className="cw-note">保留原表 7 个页签、说明、税率参考和单元格位置。岗位确认的成本会实时汇入对应栏目；有歧义的费用留给销售核对。税费若经财务确认由商务条件单列，导出主表 F45 记 0，税费测算页仍保留原公式。原表示例金额已清空，税率、税务口径和清关判断需由负责岗位复核。</p>
    <div className="cw-template-tools"><strong>自动带入 {Object.values(auto.cells).filter(cell=>cell.value!==null).length} 项</strong><span>待补或核对分类 {pendingCategories} 项 · 待人工归类 {auto.unassigned.length} 笔 · 金额核对 {issues.length} 项 · 模板主表单位 CNY</span>{draft&&<small>当前成本仍在收集或核对，导出文件是草稿，不能直接用于定价确认。</small>}</div>
    {checks.length>0&&<div className="cw-template-checks"><strong>工作台金额 ↔ 模板明细核对</strong><div>{checks.map(check=><p key={check.id} className={check.ready?'ok':'bad'}><b>{check.ready?'已核对':'待处理'} · {check.label}</b><span>{check.detail}</span></p>)}</div></div>}
    {(pendingCategories > 0 || auto.unassigned.length > 0 || confirmedLines.length > 0) && <div className="cw-template-attention"><strong>销售下一步</strong><p>返回上方岗位卡片，催齐未确认成本；收到后模板会自动更新。物料类别按名称初分，销售需核对，尤其是“其他设备”，并检查是否与补充费用重复。</p>{pendingCategories>0&&<details><summary>{pendingCategories} 个成本分类仍待补或核对</summary><ul>{Object.entries(auto.cells).filter(([,cell])=>cell.pending.length||cell.conflict).map(([key,cell])=><li key={key}>主表 {key.split(':')[1]}：{cell.conflict?'清单与补充费用重复，需核对':`待确认 ${cell.pending.join('、')}`}</li>)}</ul></details>}{auto.unassignedLines.length > 0 && <details open><summary>{auto.unassignedLines.length} 笔已确认物料需销售归类</summary><div className="cw-template-category-list">{auto.unassignedLines.map(line=><label key={line.id}><span>{line.name} · CNY {line.amount.toLocaleString('zh-CN')}</span><select aria-label={`${line.name}模板分类`} disabled={role!=='销售'} value="" onChange={event=>setCategory(line.id,event.target.value)}><option value="">选择模板栏目</option>{categoryChoices.map(([ref,name])=><option value={ref} key={ref}>{ref} · {name}</option>)}</select></label>)}</div></details>}{confirmedLines.length>0&&<details><summary>复核 {confirmedLines.length} 条已确认物料的模板分类</summary><div className="cw-template-category-list">{confirmedLines.map(line=>{const assigned=state.templateCategoryOverrides?.[line.id]?.split(':')[1];const inferred=templateCellForLine(line)?.split(':')[1];return <label key={line.id}><span>{line.name} · {assigned?'人工指定':inferred?'名称初分':'待归类'}</span><select aria-label={`${line.name}复核模板分类`} disabled={role!=='销售'} value={assigned||'__default__'} onChange={event=>setCategory(line.id,event.target.value==='__default__'?'':event.target.value)}><option value="__default__">{inferred?`按初分 ${inferred}`:'未归类'}</option>{categoryChoices.map(([ref,name])=><option value={ref} key={ref}>{ref} · {name}</option>)}</select></label>})}</div></details>}</div>}
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
        return <td key={index} id={`cw-template-${active}-${cell.ref}`} className={cell.input?effective(active,cell)===''?'cw-template-editable cw-template-empty':'cw-template-editable':cell.formula?'cw-template-formula':'cw-template-static'} title={cell.formula?'原表自动计算':undefined}>{cell.input ? renderInput(row,cell) : cell.formula ? <span>{active===0&&cell.ref==='F7'?'CNY（内部本位）':active===0&&cell.ref==='F45'&&state.extraCosts.tax?.status==='confirmed'&&state.extraCosts.tax.treatment==='separate'?'商务条件单列 · 成本记 0':'自动计算'}</span> : typeof cell.value === 'string' && cell.value.length>180 ? <details><summary>{cell.value.slice(0,72)}…</summary><div>{cell.value}</div></details> : <span>{cell.value ?? ''}</span>}{cell.comment && <details className="cw-template-comment"><summary>原表批注</summary><div>{cell.comment}</div></details>}</td>
      })}</tr>
    })}</tbody></table></div>
    <p className="cw-note">页签中的原文包括业务提醒和历史税率参考，不替代本项目的财务、关务或商务确认。导出文件可继续在 Excel 中核对和打印，无需重新排版。</p>
  </section>
}
