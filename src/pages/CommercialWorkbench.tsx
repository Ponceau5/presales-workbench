import { useMemo, useState } from 'react'
import { CircleAlert, Download, FileSpreadsheet, GitCompareArrows, Search, Bell, Send } from 'lucide-react'
import {
  allocationFor, amount, boqGroupIssues, boqGroups, commercialReadiness, convertedAmount, crmMappingIssues, crmPriceKey, extraCostDefinitions,
  importCostCsv, inventoryFor, readCommercialState, routeFor, mappingIssues, sourceFile, suggestedLines, toCsv,
  type Baseline, type CommercialState, type CostCurrency, type CostRecord, type CostRoute, type ExtraCost, type InventoryLine,
} from '@/lib/commercialWorkflow'
import type { Role } from '@/lib/workspace'
import './commercial-workbench.css'

const storageKey = (projectId: string, baseline: Baseline) => `presales-commercial-v2:${projectId}:${baseline}`
function download(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
function mark(value: string, tone: 'ok' | 'warn' | 'bad' = 'warn') {
  return <span className={`cw-mark ${tone}`}>{value}</span>
}
function sourceAnchor(sheet: string, rows: readonly number[]) {
  return `${sheet} · ${rows.map(row => `D${row}`).join(' / ')}`
}
function numberField(value: number | null, onChange: (value: number | null) => void, label: string, disabled = false) {
  return <input aria-label={label} type="number" min="0" step="0.01" value={value ?? ''} disabled={disabled}
    onChange={e => onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} />
}
function currentCost(line: InventoryLine, state: CommercialState): CostRecord {
  return state.costs[line.id] || { amount: null, status: 'pending', evidence: '', owner: line.owner, updatedAt: '' }
}
function filteredLinesForRoute(lines: InventoryLine[], route: CostRoute, query: string, filter: string, state: CommercialState) {
  return lines.filter(line => routeFor(line) === route && `${line.name} ${line.spec} ${line.material} ${line.id}`.toLowerCase().includes(query.toLowerCase()) && (filter === '全部' || (filter === '待补' && state.costs[line.id]?.status !== 'confirmed') || (filter === '已确认' && state.costs[line.id]?.status === 'confirmed')))
}

const routeMeta: Record<CostRoute, { title: string; owner: string; instruction: string }> = {
  sales: { title: '销售补充与汇总', owner: '销售', instruction: '核对厂验、包装、资金与汇率风险费用；汇总各岗位成本后制定销售价格。' },
  internal: { title: '自产产品', owner: '销售 / 产品', instruction: '从 CRM 核对物料号及价格；用于毛利测算的单位成本还需注明内部折算规则与价格版本。' },
  purchase: { title: '外购物料', owner: '采购 / 供应链', instruction: '采购向供应商询价；紧急时记录销售直询供应商及依据。' },
  software: { title: '软件成本', owner: '软件产品', instruction: '软件团队补授权、编程和相关成本。' },
  project: { title: '项目实施', owner: '项目经理', instruction: '补施工、线缆、服务、交通与调试成本。' },
  customs: { title: '物流与关税', owner: '货运关务', instruction: '按目的地、贸易术语与当期询价补运费和关税。' },
  finance: { title: '相关税费', owner: '财务 / 风控', instruction: '按项目条件提供税费测算；成本口径由财务确认。' },
}
function routeForRole(role: Role): CostRoute {
  if (role === '软件产品') return 'software'
  if (role === 'PM / PO') return 'project'
  if (role === '货运关务') return 'customs'
  if (role === '财务 / 风控') return 'finance'
  if (role === '商务支持') return 'purchase'
  if (role === '销售') return 'sales'
  return 'internal'
}
const costSteps = ['技术给配置清单', '销售按成本类型拆分并发起协作', '各岗位回填成本与依据', '销售核对并汇总成本底表', '销售按成本、客情、竞争制定价格与毛利', '形成报价初稿']

export default function CommercialWorkbench({ stage, projectId, role }: { stage: string; projectId: string; role: Role }) {
  const [state, setState] = useState<CommercialState>(() => readCommercialState(projectId))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('全部')
  const [selected, setSelected] = useState(() => inventoryFor(state.baseline).find(line=>routeFor(line)===routeForRole(role))?.id || 'BMS-1')
  const [groupId, setGroupId] = useState<string>(boqGroups[0].id)
  const [boqSearch, setBoqSearch] = useState('')
  const [message, setMessage] = useState('')
  const [activeRoute, setActiveRoute] = useState<CostRoute | null>(null)
  const lines = useMemo(() => inventoryFor(state.baseline), [state.baseline])
  const readiness = commercialReadiness(state, lines)
  const issues = mappingIssues(state, lines)
  const group = boqGroups.find(x => x.id === groupId)!
  const map = state.mappings[group.id] || { lineIds: [], confirmed: false, note: '' }
  const suggested = suggestedLines(group, lines)
  const newSuggestions = suggested.filter(id=>!map.lineIds.includes(id))
  const boqIssues = boqGroupIssues(state, group.id, lines)
  const boqCompleted = boqGroups.filter(item => state.mappings[item.id]?.confirmed && boqGroupIssues(state,item.id,lines).ready).length
  const boqCandidates = lines.filter(line => map.lineIds.includes(line.id) || (boqSearch.trim() ? `${line.name} ${line.spec} ${line.material} ${line.id}`.toLowerCase().includes(boqSearch.toLowerCase()) : suggested.includes(line.id))).sort((a,b) => Number(map.lineIds.includes(b.id))-Number(map.lineIds.includes(a.id))).slice(0,40)
  const canEditBoq = role==='销售' || role==='解决方案'
  const confirmedCosts = lines.filter(line => state.costs[line.id]?.status === 'confirmed' && !!state.costs[line.id]?.evidence)
  const quoteTotal = boqGroups.reduce((sum, item) => {
    const quote = state.quotes[item.id]
    return sum + (quote?.phase1 || 0) + (quote?.phase2 || 0) + (quote?.phase3 || 0)
  }, 0)
  const hasBoqAmount = boqGroups.some(item => { const quote=state.quotes[item.id]; return quote && [quote.phase1,quote.phase2,quote.phase3].some(value=>value!==null) })
  const directCost = lines.reduce((sum,line) => sum + (state.costs[line.id]?.status === 'confirmed' ? (state.costs[line.id]?.amount || 0) * line.quantity : 0), 0)
  const extraTotal = extraCostDefinitions.reduce((sum,item) => sum + (state.extraCosts?.[item.id]?.status === 'confirmed' && state.extraCosts[item.id].treatment !== 'separate' ? state.extraCosts[item.id].amount || 0 : 0), 0)
  const crmIssues = crmMappingIssues(state, lines)
  const allCostsReady = readiness.missingCosts.length === 0 && readiness.missingExtras.length === 0
  const myRoute = routeForRole(role)
  const pendingForRoute = (route: CostRoute) => readiness.missingExtras.filter(item=>item.route===route).length + readiness.missingCosts.filter(line=>routeFor(line)===route).length
  const myPending = pendingForRoute(myRoute)
  const routeLines = activeRoute ? filteredLinesForRoute(lines, activeRoute, query, filter, state) : []
  const activeLine = routeLines.find(line=>line.id===selected) || routeLines[0]
  const activeCost = activeLine ? currentCost(activeLine,state) : null
  const selectedExtras = extraCostDefinitions.filter(item=>item.route===activeRoute)
  const draftMargin = allCostsReady && state.draftPriceRm !== null && state.draftPriceRm > 0 ? (state.draftPriceRm-directCost-extraTotal)/state.draftPriceRm*100 : null

  function update(patch: Partial<CommercialState>) {
    const next = { ...state, ...patch, updatedAt: new Date().toISOString() }
    if (patch.costs || patch.extraCosts) next.draftPriceRm = null
    if ((patch.costs || patch.extraCosts || patch.mappings || patch.quotes || patch.crmPrices || patch.materialOverrides || patch.businessTerms || patch.pricingBasis || patch.crmOpportunity) && state.crmApproval.status === 'approved') {
      next.crmApproval = { ...state.crmApproval, status: 'revision', note: '报价输入已变更，需在 CRM 重新评审', updatedAt: new Date().toISOString() }
    }
    setState(next)
    try { localStorage.setItem(storageKey(projectId, next.baseline), JSON.stringify(next)) }
    catch { setMessage('浏览器未允许本地保存；请及时导出当前结果。') }
  }
  function setCost(line: InventoryLine, patch: Partial<CostRecord>) {
    const old = currentCost(line, state)
    const next = { ...old, ...patch, updatedAt: new Date().toISOString() }
    if (next.status === 'confirmed' && (next.amount === null || !next.evidence.trim() || (next.sourceCurrency && next.sourceCurrency !== 'RM' && (!next.fxToRm || next.fxToRm <= 0 || !next.fxEvidence?.trim())))) next.status = 'pending'
    update({ costs: { ...state.costs, [line.id]: next } })
  }
  function setCostMoney(line: InventoryLine, patch: Pick<Partial<CostRecord>, 'sourceAmount' | 'sourceCurrency' | 'fxToRm'>) {
    const old = currentCost(line,state)
    const currency = patch.sourceCurrency || old.sourceCurrency || 'RM'
    const sourceAmount = patch.sourceAmount !== undefined ? patch.sourceAmount : old.sourceAmount !== undefined ? old.sourceAmount : old.amount
    const fxToRm = currency === 'RM' ? 1 : patch.fxToRm !== undefined ? patch.fxToRm : old.sourceCurrency !== currency ? null : old.fxToRm ?? null
    setCost(line,{...patch,sourceAmount,sourceCurrency:currency,fxToRm,fxEvidence:old.sourceCurrency !== currency ? '' : old.fxEvidence,amount:convertedAmount(sourceAmount,currency,fxToRm),status:old.status==='confirmed'?'pending':old.status})
  }
  function setExtra(id: string, patch: Partial<ExtraCost>) {
    const prior = state.extraCosts?.[id] || { amount: null, evidence: '', status: 'pending', reason: '' }
    const next = { ...prior, ...patch }
    if (next.status === 'confirmed' && (next.amount === null || !next.evidence.trim() || (next.sourceCurrency && next.sourceCurrency !== 'RM' && (!next.fxToRm || next.fxToRm <= 0 || !next.fxEvidence?.trim())) || (id === 'tax' && !next.treatment))) next.status = 'pending'
    update({ extraCosts: { ...state.extraCosts, [id]: next } })
  }
  function setExtraMoney(id: string, patch: Pick<Partial<ExtraCost>, 'sourceAmount' | 'sourceCurrency' | 'fxToRm'>) {
    const old = state.extraCosts?.[id] || { amount:null, evidence:'', status:'pending' as const, reason:'' }
    const currency = patch.sourceCurrency || old.sourceCurrency || 'RM'
    const sourceAmount = patch.sourceAmount !== undefined ? patch.sourceAmount : old.sourceAmount !== undefined ? old.sourceAmount : old.amount
    const fxToRm = currency === 'RM' ? 1 : patch.fxToRm !== undefined ? patch.fxToRm : old.sourceCurrency !== currency ? null : old.fxToRm ?? null
    setExtra(id,{...patch,sourceAmount,sourceCurrency:currency,fxToRm,fxEvidence:old.sourceCurrency !== currency ? '' : old.fxEvidence,amount:convertedAmount(sourceAmount,currency,fxToRm),status:old.status==='confirmed'?'pending':old.status})
  }
  function sendRequests() {
    const now = new Date().toISOString()
    const requests = { ...state.requests }
    for (const route of Object.keys(routeMeta) as CostRoute[]) {
      if (!requests[route]?.sentAt) requests[route] = { route, sentAt: now, remindedAt: '', reminderCount: 0, channel: requests[route]?.channel || (route === 'purchase' ? '采购 / 供应商' : '工作台'), note: '' }
    }
    update({ requests })
    setMessage('已在当前浏览器记录 7 类成本协作。此 Demo 尚未接入共享数据或通知服务；可导出询价 CSV 交岗位回填。')
  }
  function remindRequests() {
    const now = new Date().toISOString()
    const requests = { ...state.requests }
    let count = 0
    for (const route of Object.keys(routeMeta) as CostRoute[]) {
      const request = requests[route]
      if (!request?.sentAt) continue
      const pending = pendingForRoute(route) > 0
      if (pending) { requests[route] = { ...request, remindedAt: now, reminderCount: request.reminderCount + 1 }; count++ }
    }
    update({ requests })
    setMessage(`已在当前浏览器记录 ${count} 类未完成岗位的催办动作；尚未向其他人发送通知。`)
  }
  function setQuote(id: string, field: 'phase1' | 'phase2' | 'phase3' | 'note', value: number | null | string) {
    const currentQuote = state.quotes[id] || { phase1: null, phase2: null, phase3: null, note: '' }
    update({ quotes: { ...state.quotes, [id]: { ...currentQuote, [field]: value } } })
  }
  function setBoqMapping(patch: Partial<typeof map>) {
    const changesTechnicalScope = patch.lineIds !== undefined || patch.allocations !== undefined || patch.note !== undefined || patch.quantityNote !== undefined
    update({ mappings: { ...state.mappings, [group.id]: { ...map, ...patch, technicalConfirmed: patch.technicalConfirmed ?? (changesTechnicalScope ? false : map.technicalConfirmed), confirmed: false } } })
  }
  function toggleBoqLine(lineId: string) {
    const selected = map.lineIds.includes(lineId)
    const lineIds = selected ? map.lineIds.filter(id=>id!==lineId) : [...map.lineIds,lineId]
    const allocations = { ...map.allocations }
    if (selected) delete allocations[lineId]
    setBoqMapping({ lineIds, allocations })
  }
  function setBoqAllocation(lineId: string, phase: number, value: number | null) {
    const current = allocationFor(state,group.id,lineId)
    const next = [...current] as [number,number,number]
    next[phase] = value ?? 0
    setBoqMapping({ allocations: { ...map.allocations, [lineId]: next } })
  }
  function setBoqQuote(phase: 'phase1' | 'phase2' | 'phase3', value: number | null) {
    const current = state.quotes[group.id] || { phase1:null, phase2:null, phase3:null, note:'' }
    update({ quotes: { ...state.quotes, [group.id]: { ...current, [phase]: value } }, mappings: { ...state.mappings, [group.id]: { ...map, confirmed: false } } })
  }
  function confirmBoqGroup() {
    if (!boqIssues.ready) return
    update({ mappings: { ...state.mappings, [group.id]: { ...map, confirmed: true } } })
    setMessage(`已核对「${group.name}」的对应物料、拆分数量和客户金额。此确认只适用于当前演示样本。`)
  }
  function exportBoqReview() {
    download(`${projectId}-F8-BOQ对照草稿-${state.baseline}.csv`,[
      ['客户分项','客户表位置','内部清单ID','内部物料','内部数量','分配一期','分配二期','分配三期','可核直接成本RM','客户一期金额RM','客户二期金额RM','客户三期金额RM','项目拆分规则','技术确认状态','技术核对记录','数量差异处理','状态'],
      ...boqGroups.flatMap(item=>{
        const mapping=state.mappings[item.id]
        const quote=state.quotes[item.id]
        const selected=lines.filter(line=>mapping?.lineIds.includes(line.id))
        const rows=selected.length?selected:[null]
        return rows.map(line=>{const qty=line?allocationFor(state,item.id,line.id):[0,0,0];const cost=line?state.costs[line.id]:undefined;const totalQty=qty.reduce((sum,value)=>sum+value,0);return [item.name,sourceAnchor(item.sheet,item.rows),line?.id||'',line?.name||'',line?.quantity??'',...qty,line&&cost?.status==='confirmed'&&cost.amount!==null?cost.amount*totalQty:'',quote?.phase1??'',quote?.phase2??'',quote?.phase3??'',mapping?.note||'',mapping?.technicalConfirmed?'已确认':'待确认',mapping?.technicalReview||'',mapping?.quantityNote||'',mapping?.confirmed&&boqGroupIssues(state,item.id,lines).ready?'已核对':'待核对']})
      }),
    ])
  }
  function setCrmPrice(groupId: string, phase: number, lineId: string, value: number | null) {
    update({crmPrices:{...state.crmPrices,[crmPriceKey(groupId,phase,lineId)]:value}})
  }
  function exportCostRequests() {
    download(`${projectId}-F7-待补成本-${state.baseline}.csv`, [
      ['配置版本', '清单ID', '系统', '序号', '名称', '规格', '物料号', '数量', '单位', '成本类型', '建议责任方', '单位成本RM', '状态', '依据/询价来源', '原币单位成本', '原币币种', '1原币折RM', '汇率来源'],
      ...lines.map(line => { const cost=state.costs[line.id]; return [state.baseline, line.id, line.sheet, line.sn, line.name, line.spec, line.material, line.quantity, line.unit, line.kind, line.owner, cost?.amount ?? '', cost?.status || 'pending', cost?.evidence || '', cost?.sourceAmount??cost?.amount??'', cost?.sourceCurrency||'RM', cost?.fxToRm??(cost?.sourceCurrency && cost.sourceCurrency!=='RM'?'':1), cost?.fxEvidence||''] }),
    ])
  }
  function exportCostBaseline() {
    download(`${projectId}-F7-成本底表-${state.baseline}.csv`,[
      ['岗位分类','清单ID','项目','物料号','数量','单位','原币金额','原币币种','1原币折RM','汇率来源','单位成本RM','成本合价RM','状态','责任方','来源/依据'],
      ...lines.map(line=>{const cost=state.costs[line.id];return [routeMeta[routeFor(line)].title,line.id,line.name,state.materialOverrides?.[line.id]||line.material,line.quantity,line.unit,cost?.sourceAmount??cost?.amount??'',cost?.sourceCurrency||'RM',cost?.fxToRm??(cost?.sourceCurrency && cost.sourceCurrency!=='RM'?'':1),cost?.fxEvidence||'',cost?.amount??'',cost?.amount===null||cost?.amount===undefined?'':cost.amount*line.quantity,cost?.status||'pending',cost?.owner||line.owner,cost?.evidence||'']}),
      ...extraCostDefinitions.map(item=>{const extra=state.extraCosts?.[item.id];const value=extra?.status==='notApplicable'?'':extra?.amount??'';return [routeMeta[item.route].title,item.id,item.name,'',1,'项',extra?.sourceAmount??value,extra?.sourceCurrency||'RM',extra?.fxToRm??(extra?.sourceCurrency && extra.sourceCurrency!=='RM'?'':1),extra?.fxEvidence||'',value,value,extra?.status||'pending',item.owner,`${extra?.evidence||extra?.reason||''}${item.id==='tax'?`；口径：${extra?.treatment||'待确认'}`:''}`]}),
      ['成本汇总','','','','','','','','','','',allCostsReady?directCost+extraTotal:'待全部成本确认','','销售','税费单列项不计入本汇总'],
    ])
  }
  function exportDraftQuote() {
    download(`${projectId}-F7-销售报价初稿-${state.baseline}.csv`,[
      ['项目','配置版本','币种','确认成本','单列税费','销售报价初稿','毛利率','定价依据','状态'],
      [projectId,state.baseline,'RM',directCost+extraTotal,state.extraCosts.tax?.status==='confirmed'&&state.extraCosts.tax.treatment==='separate'?state.extraCosts.tax.amount:0,state.draftPriceRm,draftMargin===null?'':`${draftMargin.toFixed(2)}%`,state.pricingBasis,'销售初稿·待后续流程确认'],
    ])
  }
  async function handleCostImport(file?: File) {
    if (!file) return
    try {
      const result = importCostCsv(await file.text(), state.baseline, lines)
      if (result.count) update({ costs: { ...state.costs, ...result.records } })
      setMessage(`已回填 ${result.count} 条成本；${result.errors.length} 条未导入。${result.errors.slice(0, 3).join('；')}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '文件读取失败') }
  }
  function exportHandoff() {
    download(`${projectId}-F9-CRM录入辅助-${state.baseline}.csv`, [
      ['项目', 'CRM商机号', '配置版本', '客户分项', 'Phase', '客户BOQ金额单元格', '内部配置ID', '物料号', '数量', '单位', '内部销售总价RM', '内部销售单价RM', '分摊依据', 'CRM状态'],
      ...boqGroups.flatMap(item => lines.filter(line=>state.mappings[item.id]?.confirmed && state.mappings[item.id]?.lineIds.includes(line.id)).flatMap(line => [0,1,2].flatMap(index => {
        const quantity = allocationFor(state,item.id,line.id)[index]
        if (!quantity) return []
        const price = state.crmPrices[crmPriceKey(item.id,index+1,line.id)] || 0
        return [[projectId,state.crmOpportunity,sourceFile(state.baseline),item.name,`Phase ${index+1}`,`${'FGH'[index]}${item.rows[index]}`,line.id,state.materialOverrides?.[line.id] || line.material,quantity,line.unit,price,price/quantity,state.mappings[item.id]?.note || '',state.crmApproval.status]]
      }))),
    ])
  }
  function exportApprovedHandoff() {
    download(`${projectId}-F9-批准报价交标书-${state.baseline}.csv`, [
      ['项目','配置版本','CRM商机号','CRM批准单号','客户BOQ分项','Phase 1 RM','Phase 2 RM','Phase 3 RM','商务条件','报价依据'],
      ...boqGroups.map(item => [projectId,state.baseline,state.crmOpportunity,state.crmApproval.reference,item.name,state.quotes[item.id]?.phase1 ?? '',state.quotes[item.id]?.phase2 ?? '',state.quotes[item.id]?.phase3 ?? '',state.businessTerms,state.pricingBasis]),
    ])
  }
  return <div className="commercial-workbench">
    <header className="cw-hero">
      <div>
        <span className="cw-eyebrow">COMMERCIAL WORKFLOW · RACKS CENTRAL</span>
        <h2>{stage === 'F7' ? '成本协作与报价初稿' : stage === 'F8' ? '客户 BOQ 对照与拆分' : '报价准备与 CRM 交接'}</h2>
        <p>{stage === 'F7' ? '技术给清单，销售发起，各岗位回填，销售汇总并形成报价初稿。' : stage === 'F8' ? '从客户分项开始，找内部物料，写拆分规则，分配数量与价格，再核对差异。' : '商务报价工作区'}</p>
      </div>
      <div className="cw-source">
        <span>当前配置版本</span>
        <select aria-label="配置版本" value={state.baseline} onChange={e => {
          const baseline = e.target.value as Baseline
          setState(readCommercialState(projectId, baseline))
          try { localStorage.setItem(`presales-commercial-active:${projectId}`, baseline) } catch { /* storage unavailable */ }
          setMessage('已切换配置版本；每个版本的成本、映射和报价单独保存，不能跨版本沿用。')
        }}>
          <option value="20260906">2026-09-06 · 当前候选</option>
          <option value="20260720">2026-07-20 · 历史对照</option>
        </select>
        <small title={sourceFile(state.baseline)}>{sourceFile(state.baseline)}</small>
      </div>
    </header>

    {stage === 'F7' && <section className="cw-flow" aria-label="F7 成本到报价初稿流程">
      <div className="cw-flow-title"><div><span className="cw-eyebrow">F7 · 当前确认范围</span><h3>从配置清单到销售报价初稿</h3></div><span>当前岗位：{role}</span></div>
      <ol className="cw-f7-steps">{costSteps.map((step,index)=><li key={step}><b>{index+1}</b><span>{step}</span></li>)}</ol>
    </section>}
    {message && <div className="cw-message" role="status"><CircleAlert size={16} />{message}<button onClick={() => setMessage('')}>关闭</button></div>}
    {stage === 'F7' && <p className="cw-scope">当前配置清单为 Racks Central BMS + DCOM。海外成本参考模板以人民币填写；本工作区按 RM 汇总，外币金额必须填写换算率和来源。模板及 RACKS 样表的历史金额没有导入当前成本。</p>}
    {stage !== 'F8' && <div className="cw-metrics">
      <div><span>配置行</span><strong>{lines.length}</strong><small>BMS + DCOM · {state.baseline}</small></div>
      <div><span>成本已确认</span><strong>{confirmedCosts.length}<em> / {lines.length}</em></strong><small>有金额和来源才计入</small></div>
      <div><span>补充费用待确认</span><strong>{readiness.missingExtras.length}</strong><small>含不适用判断</small></div>
      <div><span>报价初稿</span><strong>{state.draftPriceRm !== null && allCostsReady && state.pricingBasis.trim() ? '可复核' : '待补'}</strong><small>由销售确定价格与毛利</small></div>
    </div>}

    {stage === 'F7' && <div className="cw-f7-layout">
      <section className="cw-card cw-collaboration">
        <div className="cw-card-head"><div><span className="cw-eyebrow">销售发起 · 各岗位回填</span><h3>点击岗位，查看该岗位要填的事项</h3></div><div className="cw-actions">
          <button className="cw-button primary" disabled={role!=='销售'} onClick={sendRequests}><Send size={14}/>发起成本协作</button>
          <button className="cw-button" disabled={role!=='销售' || !Object.values(state.requests).some(request=>request?.sentAt)} onClick={remindRequests}><Bell size={14}/>催办未完成岗位</button>
        </div></div>
        <p className="cw-note">当前岗位 {role} · {state.requests[myRoute]?.sentAt ? `本岗位待确认 ${myPending} 项` : '等待销售发起'}。协作记录保存在当前浏览器。</p>
        <div className="cw-route-grid">{(Object.keys(routeMeta) as CostRoute[]).map(route => {
          const info=routeMeta[route], request=state.requests[route]
          const count=lines.filter(line=>routeFor(line)===route).length+extraCostDefinitions.filter(item=>item.route===route).length
          const missing=pendingForRoute(route)
          return <button key={route} className={activeRoute===route?'active':''} aria-pressed={activeRoute===route} onClick={()=>{setActiveRoute(current=>current===route?null:route);setQuery('');setFilter('全部');const first=lines.find(line=>routeFor(line)===route);if(first)setSelected(first.id)}}>
            <strong>{info.title}</strong><small>{info.owner} · {count} 项</small><span>{!request?.sentAt?'待发起':missing?`待确认 ${missing}`:'已齐'}{request?.reminderCount?` · 催办 ${request.reminderCount} 次`:''}</span>
          </button>
        })}</div>
        {!activeRoute && <p className="cw-pick-role">请选择上方岗位，查看该岗位的清单行、补充费用和回填字段。</p>}
        {activeRoute && <div className="cw-role-work">
          <div className="cw-role-work-head"><div><span className="cw-eyebrow">{routeMeta[activeRoute].owner}</span><h3>{routeMeta[activeRoute].title} · 回填事项</h3><p>{routeMeta[activeRoute].instruction}</p></div>{mark(`待确认 ${pendingForRoute(activeRoute)} 项`,pendingForRoute(activeRoute)?'bad':'ok')}</div>
          {activeRoute==='purchase' && <label className="cw-field cw-channel">询价路径<select value={state.requests.purchase?.channel||'采购 / 供应商'} onChange={e=>update({requests:{...state.requests,purchase:{...(state.requests.purchase||{route:'purchase',sentAt:'',remindedAt:'',reminderCount:0,note:''}),channel:e.target.value}}})}><option>采购 / 供应商</option><option>紧急：销售直询供应商</option></select></label>}
          {(activeRoute==='purchase'||activeRoute==='internal'||activeRoute==='software'||activeRoute==='project') && <div className="cw-role-lines">
            <div className="cw-card-head"><div><h4>技术配置清单</h4><p className="cw-note">来源：{sourceFile(state.baseline)}。自动分类待岗位核对，项目相关费用如已在清单中请避免重复填报。</p></div><div className="cw-actions"><button className="cw-button" onClick={exportCostRequests}><Download size={14}/>询价 CSV</button><label className="cw-button cw-file">批量回填 CSV<input type="file" accept=".csv,text/csv" onChange={e=>{void handleCostImport(e.target.files?.[0]);e.target.value=''}}/></label></div></div>
            <div className="cw-toolbar"><label><Search size={15}/><input aria-label="搜索当前岗位物料" placeholder="搜索当前岗位物料" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="成本状态筛选" value={filter} onChange={e=>setFilter(e.target.value)}><option>全部</option><option>待补</option><option>已确认</option></select></div>
            <div className="cw-grid"><div><div className="cw-list-head"><span>物料 / 服务</span><span>数量</span><span>负责方</span><span>状态</span></div><div className="cw-scroll-list">{routeLines.map(line=><button key={line.id} className={activeLine?.id===line.id?'cw-line selected':'cw-line'} onClick={()=>setSelected(line.id)}><span><strong>{line.name}</strong><small>{line.sheet} #{line.sn} · {line.material||'料号待核'}</small></span><span>{line.quantity} {line.unit}</span><span>{line.owner}</span><span>{state.costs[line.id]?.status==='confirmed'?mark('已确认','ok'):state.costs[line.id]?.status==='estimate'?mark('暂估'):mark('待补','bad')}</span></button>)}</div>{routeLines.length===0&&<p className="cw-empty">当前筛选下没有清单行。</p>}</div>
              {activeLine && activeCost && <aside className="cw-line-editor"><span className="cw-eyebrow">{activeLine.sheet} #{activeLine.sn}</span><h4>{activeLine.name}</h4><p className="cw-spec">{activeLine.spec}</p><div className="cw-facts"><span>数量 <b>{activeLine.quantity} {activeLine.unit}</b></span><span>料号 <b>{activeLine.material||'待核对'}</b></span></div>
                <label className="cw-field">原币单位成本{numberField(activeCost.sourceAmount??activeCost.amount,value=>setCostMoney(activeLine,{sourceAmount:value}),`${activeLine.name}原币单位成本`)}</label>
                <label className="cw-field">币种<select value={activeCost.sourceCurrency||'RM'} onChange={e=>setCostMoney(activeLine,{sourceCurrency:e.target.value as CostCurrency})}><option value="RM">RM · 马币</option><option value="CNY">CNY · 人民币</option><option value="USD">USD · 美元</option></select></label>
                {(activeCost.sourceCurrency||'RM')!=='RM' && <><label className="cw-field">1 原币 = RM{numberField(activeCost.fxToRm??null,value=>setCostMoney(activeLine,{fxToRm:value}),`${activeLine.name}汇率`)}</label><label className="cw-field">换算率来源<input value={activeCost.fxEvidence||''} onChange={e=>setCost(activeLine,{fxEvidence:e.target.value,status:activeCost.status==='confirmed'?'pending':activeCost.status})} placeholder="汇率日期、提供人或来源"/></label></>}
                <label className="cw-field">成本 / 询价依据<input value={activeCost.evidence} onChange={e=>setCost(activeLine,{evidence:e.target.value,status:activeCost.status==='confirmed'?'pending':activeCost.status})} placeholder="CRM价格折算规则、供应商报价编号等"/></label>
                <label className="cw-field">确认状态<select value={activeCost.status} onChange={e=>setCost(activeLine,{status:e.target.value as CostRecord['status']})}><option value="pending">待补 / 待复核</option><option value="estimate">暂估</option><option value="confirmed">已确认</option></select></label>
                <div className="cw-detail-footer"><strong>折合单位成本 RM {amount(activeCost.amount)}</strong><small>行成本 RM {activeCost.amount===null?'待补':amount(activeCost.amount*activeLine.quantity)}</small></div>
              </aside>}
            </div>
          </div>}
          {selectedExtras.length>0 && <div className="cw-role-extras"><h4>模板中的补充费用</h4><p className="cw-note">逐项填写本项目适用金额；已包含在配置清单的费用标为“不适用”并写明对应行。参考模板金额单位为人民币，外币需填写换算率。</p><div className="cw-extra-grid">{selectedExtras.map(item=>{const extra: ExtraCost=state.extraCosts?.[item.id]||{amount:null,evidence:'',status:'pending',reason:''};return <div key={item.id} className="cw-extra-item"><div className="cw-extra-title"><strong>{item.name}</strong><small>{item.owner} · {'template' in item?item.template:'岗位访谈'}</small></div>
            <div className="cw-money-row"><label className="cw-field">原币金额{numberField(extra.sourceAmount??extra.amount,value=>setExtraMoney(item.id,{sourceAmount:value}),`${item.name}原币金额`)}</label><label className="cw-field">币种<select value={extra.sourceCurrency||'RM'} onChange={e=>setExtraMoney(item.id,{sourceCurrency:e.target.value as CostCurrency})}><option value="RM">RM</option><option value="CNY">CNY</option><option value="USD">USD</option></select></label></div>
            {(extra.sourceCurrency||'RM')!=='RM' && <div className="cw-money-row"><label className="cw-field">1 原币 = RM{numberField(extra.fxToRm??null,value=>setExtraMoney(item.id,{fxToRm:value}),`${item.name}汇率`)}</label><label className="cw-field">汇率来源<input value={extra.fxEvidence||''} onChange={e=>setExtra(item.id,{fxEvidence:e.target.value,status:extra.status==='confirmed'?'pending':extra.status})}/></label></div>}
            <p className="cw-converted">折合 RM {amount(extra.amount)}</p><label className="cw-field">报价 / 测算依据<input value={extra.evidence} onChange={e=>setExtra(item.id,{evidence:e.target.value,status:extra.status==='confirmed'?'pending':extra.status})}/></label>
            {item.id==='tax' && <label className="cw-field">税费处理口径<select value={extra.treatment||''} onChange={e=>setExtra(item.id,{treatment:e.target.value as ExtraCost['treatment'],status:extra.status==='confirmed'?'pending':extra.status})}><option value="">待财务确认</option><option value="cost">计入项目报价成本</option><option value="separate">商务条件单列</option></select></label>}
            <label className="cw-field">状态<select value={extra.status} onChange={e=>setExtra(item.id,{status:e.target.value as ExtraCost['status']})}><option value="pending">待补</option><option value="estimate">暂估</option><option value="confirmed">已确认</option><option value="notApplicable">不适用 / 已包含</option></select></label>
            {extra.status==='notApplicable'&&<label className="cw-field">不适用 / 已包含依据<input value={extra.reason} onChange={e=>setExtra(item.id,{reason:e.target.value})} placeholder="如：已包含在 BMS-xx 清单行"/></label>}
          </div>})}</div></div>}
        </div>}
      </section>
      <section className="cw-card cw-f7-summary"><div className="cw-card-head"><div><span className="cw-eyebrow">销售汇总 · F7 最后两步</span><h3>成本底表 → 价格与毛利 → 报价初稿</h3></div><button className="cw-button" onClick={exportCostBaseline}><FileSpreadsheet size={15}/>导出成本底表</button></div>
        <div className="cw-summary-grid"><div><span>配置清单已确认</span><strong>{confirmedCosts.length} / {lines.length}</strong></div><div><span>补充费用已处理</span><strong>{extraCostDefinitions.length-readiness.missingExtras.length} / {extraCostDefinitions.length}</strong></div><div><span>成本合计 RM</span><strong>{allCostsReady?amount(directCost+extraTotal):'待补齐'}</strong></div></div>
        <p className="cw-note">成本合计仅在所有项目已确认或注明不适用后可用；税费选择“商务条件单列”时不计入毛利成本。</p>
        <div className="cw-strategy-grid"><label className="cw-field">销售报价初稿 · RM{numberField(state.draftPriceRm,value=>update({draftPriceRm:value}), '销售报价初稿 RM',role!=='销售')}</label><label className="cw-field">毛利率<input readOnly value={draftMargin===null?'成本与价格待齐':`${draftMargin.toFixed(1)}%`}/></label></div>
        <label className="cw-field">定价依据：客情、竞争与毛利判断<textarea disabled={role!=='销售'} value={state.pricingBasis} onChange={e=>update({pricingBasis:e.target.value})} placeholder="由销售说明客情、竞争、目标毛利及价格策略"/></label>
        <button className="cw-button primary" disabled={role!=='销售'||!allCostsReady||state.draftPriceRm===null||state.draftPriceRm<=0||!state.pricingBasis.trim()} onClick={exportDraftQuote}><Download size={15}/>形成并导出报价初稿</button>
      </section>
      <section className="cw-card cw-compare"><div><GitCompareArrows size={18}/><h3>版本提醒</h3></div><p>7 月与 9 月配置分别保存。技术清单变更后，成本、换算依据和销售报价须按对应版本复核。</p></section>
    </div>}

    {stage === 'F8' && <div className="cw-f8-layout">
      <section className="cw-flow"><div className="cw-flow-title"><div><span className="cw-eyebrow">F8 · 可操作的第一版</span><h3>一项一项完成客户 BOQ 对照</h3></div><span>已核对 {boqCompleted} / {boqGroups.length} 项</span></div>
        <ol className="cw-f8-steps"><li><b>1</b><span>选客户 BOQ 分项</span></li><li><b>2</b><span>找对应的内部物料</span></li><li><b>3</b><span>写拆分规则、分配数量</span></li><li><b>4</b><span>核对金额与差异</span></li></ol>
        <p>客户要求按其 BOQ 报价时使用本流程；客户接受内部格式时可沿用 F7 初稿。当前载入客户表 S2 / S3 的 14 个选取分项，尚非完整 BOQ。系统按名称给初步匹配建议，拆分方式由销售决定，设备对应和数量差异需与技术核对。</p>
      </section>
      <div className="cw-f8-workspace">
        <aside className="cw-card cw-f8-groups"><span className="cw-eyebrow">客户 BOQ</span><h3>先选一项</h3><p className="cw-note">按客户表原有分项逐个处理。点一项即可看到右侧操作。</p><div className="cw-f8-group-list">{boqGroups.map(item=>{const review=boqGroupIssues(state,item.id,lines);const confirmed=state.mappings[item.id]?.confirmed&&review.ready;return <button key={item.id} className={group.id===item.id?'active':''} onClick={()=>{setGroupId(item.id);setBoqSearch('')}}><span><strong>{item.name}</strong><small>{item.label} · {item.sheet.startsWith('S2')?'设计与编程':'硬件与基础设施'}</small></span>{mark(confirmed?'已核对':review.selected.length?'处理中':'待处理',confirmed?'ok':review.selected.length?'warn':'bad')}</button>})}</div></aside>
        <main className="cw-f8-detail">
          <section className="cw-card"><span className="cw-eyebrow">第 1 步 · 看客户要什么</span><div className="cw-f8-detail-head"><div><h3>{group.name}</h3><p>{group.label}</p></div>{mark(map.confirmed&&boqIssues.ready?'已核对':'待核对',map.confirmed&&boqIssues.ready?'ok':'warn')}</div><p className="cw-my-work">客户表位置：{sourceAnchor(group.sheet,group.rows)}。三行分别对应一期、二期、三期；请对照客户原表核实名称、单位与数量。</p></section>
          <section className="cw-card"><span className="cw-eyebrow">第 2 步 · 找内部物料</span><h3>哪些配置行属于这个客户分项？</h3><p className="cw-note">下方是按名称初筛的建议，勾选后才进入本分项。找不到时搜索物料名或料号。柜体和柜内设备可分别勾选，由销售与技术确认对应关系。</p><div className="cw-f8-search"><label><Search size={15}/><input aria-label="搜索内部物料" value={boqSearch} onChange={e=>setBoqSearch(e.target.value)} placeholder="搜索内部物料、料号或清单 ID"/></label><button className="cw-button" disabled={!canEditBoq||newSuggestions.length===0} onClick={()=>setBoqMapping({lineIds:[...new Set([...map.lineIds,...newSuggestions])]})}>加入 {newSuggestions.length} 条初筛建议</button></div><div className="cw-f8-candidates">{boqCandidates.map(line=><label key={line.id} className={map.lineIds.includes(line.id)?'checked':''}><input type="checkbox" disabled={!canEditBoq} checked={map.lineIds.includes(line.id)} onChange={()=>toggleBoqLine(line.id)}/><span><strong>{line.name}</strong><small>{line.id} · {line.material||'料号待核'} · 内部数量 {line.quantity} {line.unit}</small></span>{suggested.includes(line.id)&&<em>初筛建议</em>}</label>)}{boqCandidates.length===0&&<p className="cw-empty">没有建议项；试着搜索内部物料名称或料号。</p>}</div><p className="cw-note">已选 {map.lineIds.length} 条。初筛建议未经工程核对，不会自动确认。</p></section>
          <section className="cw-card"><span className="cw-eyebrow">第 3 步 · 定规则、分数量</span><h3>销售先说清本项目怎么拆</h3><label className="cw-field">本分项拆分规则<textarea disabled={!canEditBoq} value={map.note} onChange={e=>setBoqMapping({note:e.target.value})} placeholder="例如：按客户一期/二期的区域和设备清单分配；柜体与柜内模块分别对应客户行。请写本项目实际依据。"/></label><p className="cw-note">下表填内部清单数量在客户三期中的去向。已在其他客户分项分配的数量也会计入超量检查。</p>{boqIssues.selected.length===0?<p className="cw-empty">先在第 2 步勾选内部物料，才会出现数量表。</p>:<div className="cw-f8-allocation"><div className="cw-f8-allocation-head"><span>内部物料</span><span>一期数量</span><span>二期数量</span><span>三期数量</span><span>检查</span></div>{boqIssues.selected.map(line=>{const qty=allocationFor(state,group.id,line.id);const totalAcross=boqGroups.reduce((sum,item)=>state.mappings[item.id]?.lineIds.includes(line.id)?sum+allocationFor(state,item.id,line.id).reduce((a,b)=>a+b,0):sum,0);const over=totalAcross>line.quantity+0.000001;const cost=state.costs[line.id];return <div className="cw-f8-allocation-row" key={line.id}><span><strong>{line.name}</strong><small>{line.id} · 可用 {line.quantity} {line.unit} · 已分配 {totalAcross}</small></span>{qty.map((value,index)=><label key={index}>{numberField(value,next=>setBoqAllocation(line.id,index,next),`${line.name} ${['一期','二期','三期'][index]}数量`,!canEditBoq)}</label>)}<span>{mark(over?'超出内部数量':qty.reduce((a,b)=>a+b,0)>0?'已分配':'待分配',over?'bad':qty.reduce((a,b)=>a+b,0)>0?'ok':'warn')}<small>可核成本 RM {cost?.status==='confirmed'&&cost.amount!==null?amount(cost.amount*qty.reduce((a,b)=>a+b,0)):'待成本确认'}</small></span></div>})}</div>}<label className="cw-field">客户数量差异或增减项如何处理<textarea disabled={!canEditBoq} value={map.quantityNote||''} onChange={e=>setBoqMapping({quantityNote:e.target.value})} placeholder="如客户表数量与内部数量不同，在这里记录差异、处理方式和待技术确认的问题"/></label><label className="cw-field">与技术核对的结论或待确认点<textarea disabled={!canEditBoq} value={map.technicalReview||''} onChange={e=>setBoqMapping({technicalReview:e.target.value,technicalConfirmed:false})} placeholder="记录核对人、结论与依据；尚未确认时写清需要技术答复的问题"/></label><label className="cw-f8-tech-check"><input type="checkbox" disabled={!canEditBoq||!map.technicalReview?.trim()} checked={!!map.technicalConfirmed} onChange={e=>setBoqMapping({technicalConfirmed:e.target.checked})}/> 已与技术核对上述对应关系和数量处理</label></section>
          <section className="cw-card"><span className="cw-eyebrow">第 4 步 · 对金额、查差异</span><h3>把客户三期金额填回原分项</h3><p className="cw-note">一期、二期、三期对应客户表的三行；不适用的一期请明确填 0。金额由销售按 F7 报价初稿和本项目拆分规则决定。</p><div className="cw-f8-price-grid">{(['phase1','phase2','phase3'] as const).map((phase,index)=><label className="cw-field" key={phase}>{['一期','二期','三期'][index]}客户金额 · RM{numberField(state.quotes[group.id]?.[phase]??null,value=>setBoqQuote(phase,value),`${group.name} ${['一期','二期','三期'][index]}客户金额 RM`,!canEditBoq)}<small>客户表第 {group.rows[index]} 行</small></label>)}</div><div className="cw-f8-checks"><span>{mark(boqIssues.selected.length?'已选内部物料':'未选内部物料',boqIssues.selected.length?'ok':'bad')}</span><span>{mark(!boqIssues.selected.length?'待选物料':boqIssues.missingQuantity.length?`${boqIssues.missingQuantity.length} 条未分数量`:'数量已分配',!boqIssues.selected.length||boqIssues.missingQuantity.length?'bad':'ok')}</span><span>{mark(boqIssues.overAllocated.length?`${boqIssues.overAllocated.length} 条超量`:'无超量',boqIssues.overAllocated.length?'bad':'ok')}</span><span>{mark(map.note.trim()?'拆分规则已写':'缺拆分规则',map.note.trim()?'ok':'bad')}</span><span>{mark(map.technicalConfirmed?'技术已核对':'待技术核对',map.technicalConfirmed?'ok':'bad')}</span><span>{mark(boqIssues.missingAmounts?'客户金额未齐':'客户金额已填',boqIssues.missingAmounts?'bad':'ok')}</span></div><div className="cw-f8-bottom"><p className="cw-note">当前 14 项已录金额合计 RM {hasBoqAmount?amount(quoteTotal):'待填'}；F7 销售报价初稿 RM {amount(state.draftPriceRm)}。这里只是客户表的选取分项，金额合计仅供核对，不自动改动销售报价。</p><button className="cw-button primary" disabled={!canEditBoq||!boqIssues.ready} onClick={confirmBoqGroup}>确认本分项对照结果</button></div></section>
        </main>
      </div>
      <section className="cw-card cw-f8-export"><div><span className="cw-eyebrow">输出 · 供销售继续核对</span><h3>导出 BOQ 对照草稿</h3><p className="cw-note">保留客户行位置、对应内部物料、三期数量与金额、拆分依据和未完成状态。当前还需要真实销售案例核实拆分顺序及完整客户 BOQ 范围。</p></div><button className="cw-button" onClick={exportBoqReview}><Download size={15}/>导出对照草稿 CSV</button></section>
    </div>}

    {stage === 'F9' && <div className="cw-quote">
      <div className="cw-card-head"><div><span className="cw-eyebrow">F9 · 报价与商务交接</span><h3>客户金额、毛利与 CRM 录入稿</h3></div>{readiness.ready ? mark('选定范围可交接','ok') : mark('资料未齐','bad')}</div>
      <div className="cw-quote-top"><section className="cw-card"><span className="cw-eyebrow">选定范围报价摘要 · RM</span><strong className="cw-big">{quoteTotal ? amount(quoteTotal) : '—'}</strong><p>已填客户金额合计。{allCostsReady && !issues.unmapped.length && !issues.duplicated.length && !issues.unconfirmedGroups.length ? `已确认成本 ${amount(directCost + extraTotal)}；项目毛利 ${quoteTotal>0?`${((quoteTotal-directCost-extraTotal)/quoteTotal*100).toFixed(1)}%`:'待填报价'}。` : '成本及数量未核齐，毛利暂不作为报价依据。'}</p></section><section className="cw-card"><span className="cw-eyebrow">交接检查</span><ul><li>缺确认成本 <b>{readiness.missingCosts.length}</b></li><li>关务 / 财务待确认 <b>{readiness.missingExtras.length}</b></li><li>未确认 BOQ <b>{readiness.unconfirmedGroups.length}</b></li><li>未分摊 / 超量 <b>{readiness.unmapped.length} / {readiness.duplicated.length}</b></li><li>未填完整三期金额 <b>{readiness.missingPrices.length}</b></li><li>CRM 商机号 <b>{state.crmOpportunity.trim() ? '已填' : '待填'}</b></li></ul></section></div>
      <section className="cw-card cw-strategy"><span className="cw-eyebrow">销售决策 · 报价初稿</span><h3>记录价格策略和商务条件</h3><div className="cw-strategy-grid"><label className="cw-field">定价依据与毛利判断<textarea placeholder="填写客户关系、竞争情况、目标毛利与例外审批依据" value={state.pricingBasis} onChange={e=>update({pricingBasis:e.target.value})}/></label><label className="cw-field">给标书的商务条件<textarea placeholder="填写币种、贸易术语、税费口径、付款与有效期等已确认条件" value={state.businessTerms} onChange={e=>update({businessTerms:e.target.value})}/></label></div></section>
      <section className="cw-card cw-quote-table"><div className="cw-card-head"><div><h3>客户 BOQ 金额</h3><p>客户表金额栏按 Phase 1–3 填写，币种 RM。</p></div></div>
        <div className="cw-quote-head"><span>客户分项</span><span>Phase 1</span><span>Phase 2</span><span>Phase 3</span><span>内部成本 / 毛利</span></div>
        {boqGroups.map(item => {
          const m = state.mappings[item.id]; const q = state.quotes[item.id] || {phase1:null,phase2:null,phase3:null,note:''}
          const mapped = lines.filter(line => m?.confirmed && m.lineIds.includes(line.id) && allocationFor(state,item.id,line.id).some(x=>x>0))
          const complete = mapped.length > 0 && mapped.every(line => state.costs[line.id]?.status === 'confirmed' && state.costs[line.id]?.amount !== null && !!state.costs[line.id]?.evidence) && !mapped.some(line=>issues.duplicated.some(dup=>dup.id===line.id))
          const cost = complete ? mapped.reduce((sum,line)=>sum + (state.costs[line.id]?.amount || 0)*allocationFor(state,item.id,line.id).reduce((a,b)=>a+b,0),0) : null
          const price = [q.phase1,q.phase2,q.phase3].every(x=>x!==null) ? (q.phase1||0)+(q.phase2||0)+(q.phase3||0) : null
          return <div className="cw-quote-row" key={item.id}><span><strong>{item.name}</strong><small>{sourceAnchor(item.sheet,item.rows)}</small></span>{(['phase1','phase2','phase3'] as const).map((phase,i)=><label key={phase}>{numberField(q[phase],value=>setQuote(item.id,phase,value),`${item.name} Phase ${i+1} 金额 RM`)}</label>)}<span>{cost === null || price === null ? '待补' : <>直接成本 {amount(cost)}<br/>直接毛利 {price > 0 ? `${((price-cost)/price*100).toFixed(1)}%` : '待核'}</>}</span></div>
        })}
      </section>
      <section className="cw-card cw-crm"><div className="cw-card-head"><div><span className="cw-eyebrow">商务支持 · 对外价格转内部物料</span><h3>CRM 物料号、数量、价格逐行校验</h3></div>{readiness.missingPrices.length ? mark('报价金额待补','bad') : mark(`${crmIssues.length} 个分期未平`,crmIssues.length?'bad':'ok')}</div><p className="cw-note">选客户分项后，按 Phase 给每个内部物料分配销售总价。每期内部总价必须等于客户 BOQ 金额；商务确认拆分合理性。</p><select aria-label="选择 CRM 拆分分项" value={groupId} onChange={e=>setGroupId(e.target.value)}>{boqGroups.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><div className="cw-crm-table"><div className="cw-crm-row header"><span>内部物料</span><span>CRM 料号</span><span>Phase</span><span>数量</span><span>内部销售总价 RM</span></div>{lines.filter(line=>map.confirmed && map.lineIds.includes(line.id)).flatMap(line=>[0,1,2].filter(index=>allocationFor(state,group.id,line.id)[index]>0).map(index=><div className="cw-crm-row" key={`${line.id}-${index}`}><span><b>{line.name}</b><small>{line.id}</small></span><input aria-label={`${line.name} CRM 料号`} disabled={role!=='商务支持'} value={state.materialOverrides?.[line.id] ?? line.material} onChange={e=>update({materialOverrides:{...state.materialOverrides,[line.id]:e.target.value}})}/><span>P{index+1}</span><span>{allocationFor(state,group.id,line.id)[index]} {line.unit}</span>{numberField(state.crmPrices?.[crmPriceKey(group.id,index+1,line.id)] ?? null,value=>setCrmPrice(group.id,index+1,line.id,value),`${line.name} Phase ${index+1} 内部销售总价 RM`,role!=='商务支持')}</div>))}</div>{!map.confirmed && <p className="cw-empty">请先在 F8 确认此分项的物料与数量。</p>}<p className="cw-hint">当前分项客户金额：{[1,2,3].map(index=>`P${index} ${amount(state.quotes[group.id]?.[`phase${index}` as 'phase1'|'phase2'|'phase3'] ?? null)}`).join(' · ')}</p></section>
      <section className="cw-card cw-handoff"><div><span className="cw-eyebrow">CRM 录入与评审</span><h3>审批版本跟踪</h3><p>记录 CRM 的真实审批状态；导出的是人工录入辅助 CSV，不会直接写入 CRM。</p><label className="cw-field">CRM 商机编号<input value={state.crmOpportunity} placeholder="录入实际商机编号" onChange={e=>update({crmOpportunity:e.target.value})}/></label><label className="cw-field">CRM 报价 / 审批单号<input disabled={role!=='商务支持'} value={state.crmApproval.reference} onChange={e=>update({crmApproval:{...state.crmApproval,reference:e.target.value,status:state.crmApproval.status==='approved'?'revision':state.crmApproval.status}})}/></label><label className="cw-field">CRM 实际状态<select disabled={role!=='商务支持'} value={state.crmApproval.status} onChange={e=>{const status=e.target.value as CommercialState['crmApproval']['status']; if(status!=='draft' && (!readiness.ready || crmIssues.length || !state.crmApproval.reference.trim())) {setMessage('请先补齐报价、内部物料分摊和 CRM 审批单号，再记录实际审批状态。');return} update({crmApproval:{...state.crmApproval,status,updatedAt:new Date().toISOString()}})}}><option value="draft">报价初稿 / 未提交</option><option value="submitted">已在 CRM 发起评审</option><option value="revision">修改 / 撤回 / 待重提</option><option value="approved">CRM 已批准</option></select></label><label className="cw-field">审批或修改记录<textarea disabled={role!=='商务支持'} value={state.crmApproval.note} onChange={e=>update({crmApproval:{...state.crmApproval,note:e.target.value}})} placeholder="记录退回原因、重提版本或批准意见"/></label></div><div className="cw-handoff-actions"><button className="cw-button primary" disabled={role!=='商务支持' || !readiness.ready || crmIssues.length>0} onClick={exportHandoff}><FileSpreadsheet size={16}/>导出 CRM 逐行录入稿</button><button className="cw-button" disabled={role!=='商务支持' || state.crmApproval.status!=='approved' || !state.crmApproval.reference.trim() || !readiness.ready || crmIssues.length>0} onClick={exportApprovedHandoff}><Download size={16}/>输出批准报价给标书</button></div></section>
      <p className="cw-hint">选定范围为客户 BMS 表 S2 / S3 的 14 个分项。项目总毛利计入已确认海外费用；分项直接毛利尚未分摊海外费用。完整报价仍需复核客户表其他范围。</p>
    </div>}
  </div>
}
