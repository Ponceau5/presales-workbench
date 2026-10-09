import { useMemo, useState } from 'react'
import { CircleAlert, Download, FileSpreadsheet, GitCompareArrows, Search, Bell, Send } from 'lucide-react'
import {
  allocationFor, amount, boqGroupIssues, boqGroups, commercialReadiness, convertedAmount, crmMappingIssues, crmPriceKey, extraCostDefinitions,
  importCostCsv, inventoryFor, pricingBreakdown, quoteCurrencyPatch, quotePricingTotal, quoteRateReady, readCommercialState, routeFor, mappingIssues, sourceFile, suggestedLines, toCsv, toQuoteAmount,
  type Baseline, type CommercialState, type CostCurrency, type CostRecord, type CostRoute, type ExtraCost, type InventoryLine, type PriceCategory,
} from '@/lib/commercialWorkflow'
import type { Role } from '@/lib/workspace'
import './commercial-workbench.css'

const storageKey = (projectId: string, baseline: Baseline) => `presales-commercial-v3:${projectId}:${baseline}`
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
const costSteps = ['技术给配置清单', '销售分类发起成本协作', '各岗位按人民币回填成本与依据', '销售确认并导出成本版', '销售选报价币种、填写分类原则，Agent 生成建议价', '销售逐项调整，核对成本与报价', '销售确认并导出报价版']
const priceCategoryLabels: Record<PriceCategory, string> = { internal: '自产产品', purchase: '外购设备', software: '软件', project: '施工 / 服务', extras: '补充费用' }

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
  const pricing = pricingBreakdown(state, lines)
  const liveQuoteTotal = quotePricingTotal(state, pricing)
  const crmIssues = crmMappingIssues(state, lines)
  const allCostsReady = readiness.missingCosts.length === 0 && readiness.missingExtras.length === 0
  const myRoute = routeForRole(role)
  const pendingForRoute = (route: CostRoute) => readiness.missingExtras.filter(item=>item.route===route).length + readiness.missingCosts.filter(line=>routeFor(line)===route).length
  const myPending = pendingForRoute(myRoute)
  const routeLines = activeRoute ? filteredLinesForRoute(lines, activeRoute, query, filter, state) : []
  const activeLine = routeLines.find(line=>line.id===selected) || routeLines[0]
  const activeCost = activeLine ? currentCost(activeLine,state) : null
  const selectedExtras = extraCostDefinitions.filter(item=>item.route===activeRoute)
  const draftMargin = allCostsReady && state.draftPriceCny !== null && state.draftPriceCny > 0 ? (state.draftPriceCny-directCost-extraTotal)/state.draftPriceCny*100 : null
  const quoteTotalDraft = state.quoteConfirmedAt && state.draftPriceCny !== null ? liveQuoteTotal : null

  function update(patch: Partial<CommercialState>) {
    const next = { ...state, ...patch, updatedAt: new Date().toISOString() }
    if (patch.costs || patch.extraCosts || patch.pricingRules || patch.lineFactorOverrides || patch.linePriceOverrides || patch.extraPriceOverrides || patch.pricingBasis !== undefined || patch.quoteCurrency || patch.quoteFxFromCny !== undefined || patch.quoteFxEvidence !== undefined) {
      next.draftPriceCny = null
      next.quoteConfirmedAt = ''
    }
    if (patch.quoteFxFromCny !== undefined || patch.quoteFxEvidence !== undefined) next.mappings = Object.fromEntries(Object.entries(state.mappings).map(([id,mapping])=>[id,{...mapping,confirmed:false}]))
    if ((patch.costs || patch.extraCosts || patch.mappings || patch.quotes || patch.crmPrices || patch.materialOverrides || patch.businessTerms || patch.pricingBasis !== undefined || patch.crmOpportunity || patch.quoteCurrency || patch.quoteFxFromCny !== undefined || patch.quoteFxEvidence !== undefined) && state.crmApproval.status === 'approved') {
      next.crmApproval = { ...state.crmApproval, status: 'revision', note: '报价输入已变更，需在 CRM 重新评审', updatedAt: new Date().toISOString() }
    }
    setState(next)
    try { localStorage.setItem(storageKey(projectId, next.baseline), JSON.stringify(next)) }
    catch { setMessage('浏览器未允许本地保存；请及时导出当前结果。') }
  }
  function changeQuoteCurrency(currency: CostCurrency) {
    if (currency === state.quoteCurrency) return
    const hasDownstreamPrices = Object.values(state.quotes).some(quote=>[quote.phase1,quote.phase2,quote.phase3].some(value=>value!==null)) || Object.keys(state.crmPrices).length > 0
    update(quoteCurrencyPatch(state,currency))
    setMessage(hasDownstreamPrices ? `报价币种已改为 ${currency}。旧 ${state.quoteCurrency} BOQ / CRM 金额已存为备份，当前分项金额需按新币种重新填写和确认。` : `报价币种已改为 ${currency}；${currency==='CNY'?'无需换算汇率。':'请填写项目报价换算率和来源。'}`)
  }
  function changeQuoteRate(value: number | null) {
    if (value === state.quoteFxFromCny) return
    const hasDownstreamPrices = Object.values(state.quotes).some(quote=>[quote.phase1,quote.phase2,quote.phase3].some(amount=>amount!==null)) || Object.keys(state.crmPrices).length > 0
    update({ ...quoteCurrencyPatch(state,state.quoteCurrency), quoteFxFromCny:value, quoteFxEvidence:state.quoteFxEvidence })
    if (hasDownstreamPrices) setMessage('项目报价汇率已变更。原 BOQ / CRM 金额已备份，需按新汇率重新填写并确认。')
  }
  function setCost(line: InventoryLine, patch: Partial<CostRecord>) {
    const old = currentCost(line, state)
    const next = { ...old, ...patch, updatedAt: new Date().toISOString() }
    if (next.status === 'confirmed' && (next.amount === null || !next.evidence.trim() || (next.sourceCurrency && next.sourceCurrency !== 'CNY' && (!next.fxToCny || next.fxToCny <= 0 || !next.fxEvidence?.trim())))) next.status = 'pending'
    update({ costs: { ...state.costs, [line.id]: next } })
  }
  function setCostMoney(line: InventoryLine, patch: Pick<Partial<CostRecord>, 'sourceAmount' | 'sourceCurrency' | 'fxToCny'>) {
    const old = currentCost(line,state)
    const currency = patch.sourceCurrency || old.sourceCurrency || 'CNY'
    const sourceAmount = patch.sourceAmount !== undefined ? patch.sourceAmount : old.sourceAmount !== undefined ? old.sourceAmount : old.amount
    const fxToCny = currency === 'CNY' ? 1 : patch.fxToCny !== undefined ? patch.fxToCny : old.sourceCurrency !== currency ? null : old.fxToCny ?? null
    setCost(line,{...patch,sourceAmount,sourceCurrency:currency,fxToCny,fxEvidence:old.sourceCurrency !== currency ? '' : old.fxEvidence,amount:convertedAmount(sourceAmount,currency,fxToCny),status:old.status==='confirmed'?'pending':old.status})
  }
  function setExtra(id: string, patch: Partial<ExtraCost>) {
    const prior = state.extraCosts?.[id] || { amount: null, evidence: '', status: 'pending', reason: '' }
    const next = { ...prior, ...patch }
    if (next.status === 'confirmed' && (next.amount === null || !next.evidence.trim() || (next.sourceCurrency && next.sourceCurrency !== 'CNY' && (!next.fxToCny || next.fxToCny <= 0 || !next.fxEvidence?.trim())) || (id === 'tax' && !next.treatment))) next.status = 'pending'
    update({ extraCosts: { ...state.extraCosts, [id]: next } })
  }
  function setExtraMoney(id: string, patch: Pick<Partial<ExtraCost>, 'sourceAmount' | 'sourceCurrency' | 'fxToCny'>) {
    const old = state.extraCosts?.[id] || { amount:null, evidence:'', status:'pending' as const, reason:'' }
    const currency = patch.sourceCurrency || old.sourceCurrency || 'CNY'
    const sourceAmount = patch.sourceAmount !== undefined ? patch.sourceAmount : old.sourceAmount !== undefined ? old.sourceAmount : old.amount
    const fxToCny = currency === 'CNY' ? 1 : patch.fxToCny !== undefined ? patch.fxToCny : old.sourceCurrency !== currency ? null : old.fxToCny ?? null
    setExtra(id,{...patch,sourceAmount,sourceCurrency:currency,fxToCny,fxEvidence:old.sourceCurrency !== currency ? '' : old.fxEvidence,amount:convertedAmount(sourceAmount,currency,fxToCny),status:old.status==='confirmed'?'pending':old.status})
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
      ['客户分项','客户表位置','内部清单ID','内部物料','内部数量','分配一期','分配二期','分配三期','可核直接成本CNY',`客户一期金额${state.quoteCurrency}`,`客户二期金额${state.quoteCurrency}`,`客户三期金额${state.quoteCurrency}`,'项目拆分规则','技术确认状态','技术核对记录','数量差异处理','状态'],
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
      ['配置版本', '清单ID', '系统', '序号', '名称', '规格', '物料号', '数量', '单位', '成本类型', '建议责任方', '单位成本CNY', '状态', '依据/询价来源', '原币单位成本', '原币币种', '1原币折CNY', '汇率来源'],
      ...lines.map(line => { const cost=state.costs[line.id]; return [state.baseline, line.id, line.sheet, line.sn, line.name, line.spec, line.material, line.quantity, line.unit, line.kind, line.owner, cost?.amount ?? '', cost?.status || 'pending', cost?.evidence || '', cost?.sourceAmount??cost?.amount??'', cost?.sourceCurrency||'CNY', cost?.fxToCny??(cost?.sourceCurrency && cost.sourceCurrency!=='CNY'?'':1), cost?.fxEvidence||''] }),
    ])
  }
  function exportCostBaseline() {
    download(`${projectId}-F7-成本底表-${state.baseline}.csv`,[
      ['岗位分类','清单ID','项目','物料号','数量','单位','原币金额','原币币种','1原币折CNY','汇率来源','单位成本CNY','成本合价CNY','状态','责任方','来源/依据'],
      ...lines.map(line=>{const cost=state.costs[line.id];return [routeMeta[routeFor(line)].title,line.id,line.name,state.materialOverrides?.[line.id]||line.material,line.quantity,line.unit,cost?.sourceAmount??cost?.amount??'',cost?.sourceCurrency||'CNY',cost?.fxToCny??(cost?.sourceCurrency && cost.sourceCurrency!=='CNY'?'':1),cost?.fxEvidence||'',cost?.amount??'',cost?.amount===null||cost?.amount===undefined?'':cost.amount*line.quantity,cost?.status||'pending',cost?.owner||line.owner,cost?.evidence||'']}),
      ...extraCostDefinitions.map(item=>{const extra=state.extraCosts?.[item.id];const value=extra?.status==='notApplicable'?'':extra?.amount??'';return [routeMeta[item.route].title,item.id,item.name,'',1,'项',extra?.sourceAmount??value,extra?.sourceCurrency||'CNY',extra?.fxToCny??(extra?.sourceCurrency && extra.sourceCurrency!=='CNY'?'':1),extra?.fxEvidence||'',value,value,extra?.status||'pending',item.owner,`${extra?.evidence||extra?.reason||''}${item.id==='tax'?`；口径：${extra?.treatment||'待确认'}`:''}`]}),
      ['成本汇总','','','','','','','','','','',allCostsReady?directCost+extraTotal:'待全部成本确认','','销售','税费单列项不计入本汇总'],
    ])
  }
  function exportDraftQuote() {
    download(`${projectId}-F7-销售确认报价版-${state.baseline}.csv`,[
      ['项目','配置版本','清单ID','成本类型','名称','物料号','数量','单位成本CNY','计入毛利的成本合计CNY','报价系数','Agent建议单价CNY','Agent建议合价CNY','销售确认单价CNY','销售确认合价CNY',`销售确认单价${state.quoteCurrency}`,`销售确认合价${state.quoteCurrency}`,'1CNY折报价币种','报价汇率来源','行毛利率','是否人工调整','报价状态','定价依据'],
      ...pricing.rows.map(row => [projectId,state.baseline,row.id,priceCategoryLabels[row.category],row.name,state.materialOverrides?.[row.id]||row.material,row.quantity,row.unitCost,row.costTotal,row.factor,row.suggestedUnit,row.suggestedTotal,row.finalUnit,row.finalTotal,toQuoteAmount(row.finalUnit,state),toQuoteAmount(row.finalTotal,state),state.quoteCurrency==='CNY'?1:state.quoteFxFromCny,state.quoteCurrency==='CNY'?'人民币本位':state.quoteFxEvidence,row.finalTotal && row.costTotal !== null ? `${((row.finalTotal-row.costTotal)/row.finalTotal*100).toFixed(2)}%` : '',row.edited?'是':'否','销售已确认，待后续 BOQ / CRM',state.pricingBasis]),
      ...pricing.extras.map(row => [projectId,state.baseline,row.id,'补充费用',row.name,'',1,row.cost,row.cost,row.factor,row.suggested,row.suggested,row.final,row.final,toQuoteAmount(row.final,state),toQuoteAmount(row.final,state),state.quoteCurrency==='CNY'?1:state.quoteFxFromCny,state.quoteCurrency==='CNY'?'人民币本位':state.quoteFxEvidence,row.final && row.cost !== null ? `${((row.final-row.cost)/row.final*100).toFixed(2)}%` : '',row.edited?'是':'否','销售已确认，待后续 BOQ / CRM',state.pricingBasis]),
      [projectId,state.baseline,'合计','','','','','',pricing.costTotal,'','',pricing.suggestedTotal,'',state.draftPriceCny,'',quoteTotalDraft,state.quoteCurrency==='CNY'?1:state.quoteFxFromCny,state.quoteCurrency==='CNY'?'人民币本位':state.quoteFxEvidence,draftMargin===null?'':`${draftMargin.toFixed(2)}%`,'','销售已确认，待后续 BOQ / CRM',state.pricingBasis],
      ...(state.extraCosts.tax?.status==='confirmed'&&state.extraCosts.tax.treatment==='separate' ? [[projectId,state.baseline,'tax','商务条件单列','相关税费','',1,state.extraCosts.tax.amount,'','','','','','','','','','','','','不计入以上成本和报价合计，须在后续商务条件中单列',state.extraCosts.tax.evidence]] : []),
    ])
  }
  function exportPriorQuoteCurrency() {
    const backup = state.quoteCurrencyHistory.at(-1)
    if (!backup) return
    download(`${projectId}-旧币种金额备份-${backup.currency}-${state.baseline}.csv`,[
      ['类型','分项或键','一期金额','二期金额','三期金额','币种','1CNY折报价币种','汇率来源','保存时间'],
      ...Object.entries(backup.quotes).map(([id,quote])=>['客户BOQ',id,quote.phase1??'',quote.phase2??'',quote.phase3??'',backup.currency,backup.fxFromCny??'',backup.fxEvidence||'',backup.savedAt]),
      ...Object.entries(backup.crmPrices).map(([key,value])=>['CRM分摊',key,value??'','','',backup.currency,backup.fxFromCny??'',backup.fxEvidence||'',backup.savedAt]),
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
      ['项目', 'CRM商机号', '配置版本', '客户分项', 'Phase', '客户BOQ金额单元格', '内部配置ID', '物料号', '数量', '单位', `内部销售总价${state.quoteCurrency}`, `内部销售单价${state.quoteCurrency}`, '分摊依据', 'CRM状态'],
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
      ['项目','配置版本','CRM商机号','CRM批准单号','客户BOQ分项',`Phase 1 ${state.quoteCurrency}`,`Phase 2 ${state.quoteCurrency}`,`Phase 3 ${state.quoteCurrency}`,'商务条件','报价依据'],
      ...boqGroups.map(item => [projectId,state.baseline,state.crmOpportunity,state.crmApproval.reference,item.name,state.quotes[item.id]?.phase1 ?? '',state.quotes[item.id]?.phase2 ?? '',state.quotes[item.id]?.phase3 ?? '',state.businessTerms,state.pricingBasis]),
    ])
  }
  return <div className="commercial-workbench">
    <header className="cw-hero">
      <div>
        <span className="cw-eyebrow">COMMERCIAL WORKFLOW · RACKS CENTRAL</span>
        <h2>{stage === 'F7' ? '成本版与销售报价版' : stage === 'F8' ? '客户 BOQ 对照与拆分' : '报价准备与 CRM 交接'}</h2>
        <p>{stage === 'F7' ? '多岗位回填成本，销售设定分类报价原则，Agent 生成建议价，销售调整并确认报价。' : stage === 'F8' ? '从客户分项开始，找内部物料，写拆分规则，分配数量与价格，再核对差异。' : '商务报价工作区'}</p>
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

    {stage === 'F7' && <section className="cw-flow" aria-label="F7 成本版到报价版流程">
      <div className="cw-flow-title"><div><span className="cw-eyebrow">F7 · 当前确认范围</span><h3>从配置清单到成本版、报价版</h3></div><span>当前岗位：{role}</span></div>
      <ol className="cw-f7-steps">{costSteps.map((step,index)=><li key={step}><b>{index+1}</b><span>{step}</span></li>)}</ol>
    </section>}
    {message && <div className="cw-message" role="status"><CircleAlert size={16} />{message}<button onClick={() => setMessage('')}>关闭</button></div>}
    {stage === 'F7' && <p className="cw-scope">内部成本与销售定价统一按人民币（CNY）计算。成本默认填人民币；取得外币报价时，记录原币金额、折人民币汇率和来源。销售确认后，再按本项目所选报价币种换算对外金额。参考模板和 RACKS 样表的历史金额未导入当前成本。</p>}
    {stage !== 'F8' && <div className="cw-metrics">
      <div><span>配置行</span><strong>{lines.length}</strong><small>BMS + DCOM · {state.baseline}</small></div>
      <div><span>成本已确认</span><strong>{confirmedCosts.length}<em> / {lines.length}</em></strong><small>有金额和来源才计入</small></div>
      <div><span>补充费用待确认</span><strong>{readiness.missingExtras.length}</strong><small>含不适用判断</small></div>
      <div><span>报价版</span><strong>{state.quoteConfirmedAt && allCostsReady ? '销售已确认' : '待销售确认'}</strong><small>先生成建议价，再人工调整</small></div>
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
                <label className="cw-field">单位成本金额（默认人民币）{numberField(activeCost.sourceAmount??activeCost.amount,value=>setCostMoney(activeLine,{sourceAmount:value}),`${activeLine.name}单位成本金额`)}</label>
                {activeCost.legacyAmountRm !== undefined && activeCost.sourceCurrency !== 'CNY' && <p className="cw-agent-note">旧版这行折合 RM {amount(activeCost.legacyAmountRm)}。原币金额已保留；请填写新的折人民币汇率并重新确认。</p>}
                <label className="cw-field">这笔成本的币种<select value={activeCost.sourceCurrency||'CNY'} onChange={e=>setCostMoney(activeLine,{sourceCurrency:e.target.value as CostCurrency})}><option value="CNY">CNY · 人民币（默认）</option><option value="RM">RM · 马币</option><option value="USD">USD · 美元</option></select></label>
                {(activeCost.sourceCurrency||'CNY')!=='CNY' && <><label className="cw-field">1 {activeCost.sourceCurrency} = 多少 CNY{numberField(activeCost.fxToCny??null,value=>setCostMoney(activeLine,{fxToCny:value}),`${activeLine.name}折人民币汇率`)}</label><label className="cw-field">折人民币汇率来源<input value={activeCost.fxEvidence||''} onChange={e=>setCost(activeLine,{fxEvidence:e.target.value,status:activeCost.status==='confirmed'?'pending':activeCost.status})} placeholder="财务提供的汇率、日期和依据"/></label></>}
                <label className="cw-field">成本 / 询价依据<input value={activeCost.evidence} onChange={e=>setCost(activeLine,{evidence:e.target.value,status:activeCost.status==='confirmed'?'pending':activeCost.status})} placeholder="CRM价格折算规则、供应商报价编号等"/></label>
                <label className="cw-field">确认状态<select value={activeCost.status} onChange={e=>setCost(activeLine,{status:e.target.value as CostRecord['status']})}><option value="pending">待补 / 待复核</option><option value="estimate">暂估</option><option value="confirmed">已确认</option></select></label>
                <div className="cw-detail-footer"><strong>折合人民币单位成本 CNY {amount(activeCost.amount)}</strong><small>行成本 CNY {activeCost.amount===null?'待补':amount(activeCost.amount*activeLine.quantity)}</small></div>
              </aside>}
            </div>
          </div>}
          {selectedExtras.length>0 && <div className="cw-role-extras"><h4>模板中的补充费用</h4><p className="cw-note">逐项填写本项目适用金额；已包含在配置清单的费用标为“不适用”并写明对应行。工作台成本统一折算为人民币，外币费用需填写换算率。</p><div className="cw-extra-grid">{selectedExtras.map(item=>{const extra: ExtraCost=state.extraCosts?.[item.id]||{amount:null,evidence:'',status:'pending',reason:''};return <div key={item.id} className="cw-extra-item"><div className="cw-extra-title"><strong>{item.name}</strong><small>{item.owner} · {'template' in item?item.template:'岗位访谈'}</small></div>
            <div className="cw-money-row"><label className="cw-field">费用金额（默认人民币）{numberField(extra.sourceAmount??extra.amount,value=>setExtraMoney(item.id,{sourceAmount:value}),`${item.name}费用金额`)}</label><label className="cw-field">这笔费用的币种<select value={extra.sourceCurrency||'CNY'} onChange={e=>setExtraMoney(item.id,{sourceCurrency:e.target.value as CostCurrency})}><option value="CNY">CNY（默认）</option><option value="RM">RM</option><option value="USD">USD</option></select></label></div>
            {extra.legacyAmountRm !== undefined && extra.sourceCurrency !== 'CNY' && <p className="cw-agent-note">旧版折合 RM {amount(extra.legacyAmountRm)} 已留作参考；请重新确认折人民币汇率。</p>}
            {(extra.sourceCurrency||'CNY')!=='CNY' && <div className="cw-money-row"><label className="cw-field">1 {extra.sourceCurrency} = 多少 CNY{numberField(extra.fxToCny??null,value=>setExtraMoney(item.id,{fxToCny:value}),`${item.name}折人民币汇率`)}</label><label className="cw-field">折人民币汇率来源<input value={extra.fxEvidence||''} onChange={e=>setExtra(item.id,{fxEvidence:e.target.value,status:extra.status==='confirmed'?'pending':extra.status})}/></label></div>}
            <p className="cw-converted">折合人民币 CNY {amount(extra.amount)}</p><label className="cw-field">报价 / 测算依据<input value={extra.evidence} onChange={e=>setExtra(item.id,{evidence:e.target.value,status:extra.status==='confirmed'?'pending':extra.status})}/></label>
            {item.id==='tax' && <label className="cw-field">税费处理口径<select value={extra.treatment||''} onChange={e=>setExtra(item.id,{treatment:e.target.value as ExtraCost['treatment'],status:extra.status==='confirmed'?'pending':extra.status})}><option value="">待财务确认</option><option value="cost">计入项目报价成本</option><option value="separate">商务条件单列</option></select></label>}
            <label className="cw-field">状态<select value={extra.status} onChange={e=>setExtra(item.id,{status:e.target.value as ExtraCost['status']})}><option value="pending">待补</option><option value="estimate">暂估</option><option value="confirmed">已确认</option><option value="notApplicable">不适用 / 已包含</option></select></label>
            {extra.status==='notApplicable'&&<label className="cw-field">不适用 / 已包含依据<input value={extra.reason} onChange={e=>setExtra(item.id,{reason:e.target.value})} placeholder="如：已包含在 BMS-xx 清单行"/></label>}
          </div>})}</div></div>}
        </div>}
      </section>
      <section className="cw-card cw-f7-summary"><div className="cw-card-head"><div><span className="cw-eyebrow">第 4 步 · 成本版</span><h3>销售核对并输出成本底稿</h3></div><button className="cw-button" disabled={!allCostsReady} onClick={exportCostBaseline}><FileSpreadsheet size={15}/>导出成本版 CSV</button></div>
        <div className="cw-summary-grid"><div><span>配置清单已确认</span><strong>{confirmedCosts.length} / {lines.length}</strong></div><div><span>补充费用已处理</span><strong>{extraCostDefinitions.length-readiness.missingExtras.length} / {extraCostDefinitions.length}</strong></div><div><span>成本合计 CNY</span><strong>{allCostsReady?amount(directCost+extraTotal):'待补齐'}</strong></div></div>
        <p className="cw-note">成本合计仅在所有项目已确认或注明不适用后可用；税费选择“商务条件单列”时不计入毛利成本。</p>
      </section>
      <section className="cw-card cw-f7-currency"><div className="cw-card-head"><div><span className="cw-eyebrow">项目设置 · 对外报价币种</span><h3>先用人民币算价格，再换算成客户要求的币种</h3></div>{mark(quoteRateReady(state)?'报价换算已齐':'待填报价汇率',quoteRateReady(state)?'ok':'bad')}</div>
        <div className="cw-quote-currency-grid"><label className="cw-field">客户要求的报价币种<select value={state.quoteCurrency} disabled={role!=='销售'} onChange={e=>changeQuoteCurrency(e.target.value as CostCurrency)}><option value="CNY">CNY · 人民币</option><option value="RM">RM · 马币</option><option value="USD">USD · 美元</option></select></label>
          {state.quoteCurrency !== 'CNY' && <><label className="cw-field">1 CNY = 多少 {state.quoteCurrency}{numberField(state.quoteFxFromCny,changeQuoteRate,`人民币折${state.quoteCurrency}报价汇率`,role!=='销售')}</label><label className="cw-field">报价汇率来源及日期<input disabled={role!=='销售'} value={state.quoteFxEvidence} onChange={e=>update({quoteFxEvidence:e.target.value})} placeholder="财务确认的项目报价汇率、日期"/></label></>}</div>
        <p className="cw-note">内部成本、系数和毛利始终按 CNY 计算。{state.quoteCurrency==='CNY'?'本项目对外仍报人民币，不需要汇率。':`对外报价按确认的 1 CNY = ${state.quoteFxFromCny ?? '待填'} ${state.quoteCurrency} 换算；系统不自动获取实时汇率。`}{state.quoteCurrencyHistory.length>0?` 已保留 ${state.quoteCurrencyHistory.length} 次旧报价金额备份；更换币种或汇率后须重填下游金额。`:''}</p>
        {state.quoteCurrencyHistory.length>0 && <button className="cw-button" onClick={exportPriorQuoteCurrency}><Download size={14}/>导出上次旧报价金额备份</button>}
      </section>
      <section className="cw-card cw-f7-pricing"><div className="cw-card-head"><div><span className="cw-eyebrow">第 5 步 · 销售填写报价原则</span><h3>按类别设置系数，Agent 计算建议价</h3></div>{mark(allCostsReady?'成本版已齐':'等待成本版',allCostsReady?'ok':'bad')}</div>
        <p className="cw-note">3.3 倍与 1.3 倍来自销售举例，均为可改的演示起点；外购也可改为 1.5 倍。软件、施工 / 服务由销售填写本项目系数。补充费用默认按成本计入报价，可调整。系数不是公司批准的定价政策。</p>
        <div className="cw-pricing-rules">{(Object.keys(priceCategoryLabels) as PriceCategory[]).map(category=><label className="cw-field" key={category}>{priceCategoryLabels[category]} · 成本 × 系数
          <input type="number" min="0.01" step="0.1" value={state.pricingRules[category]??''} disabled={role!=='销售'} placeholder="待销售填写" onChange={e=>update({pricingRules:{...state.pricingRules,[category]:e.target.value===''?null:Math.max(0,Number(e.target.value))}})}/>
        </label>)}</div>
        <label className="cw-field">销售报价原则与判断：客情、竞争、目标毛利<textarea disabled={role!=='销售'} value={state.pricingBasis} onChange={e=>update({pricingBasis:e.target.value})} placeholder="例如：自产按 3.3 倍；外购按 1.3 倍，竞争激烈的指定物料另行调整。写明客户情况及调整理由。"/></label>
        <p className="cw-agent-note">Agent 只按已确认成本和系数计算建议价；缺成本或系数的行不生成建议价。逐项调整和最终报价由销售负责。</p>
      </section>
      <section className="cw-card cw-f7-pricing"><div className="cw-card-head"><div><span className="cw-eyebrow">第 6 步 · 成本与报价对比</span><h3>销售逐项调整，实时查看毛利</h3></div><span className="cw-note">已人工调整 {pricing.editedCount} 项</span></div>
        <div className="cw-pricing-totals"><div><span>成本版 · CNY</span><strong>{allCostsReady?amount(pricing.costTotal):'待补齐'}</strong></div><div><span>Agent 建议价 · CNY</span><strong>{allCostsReady&&pricing.suggestedTotal!==null?amount(pricing.suggestedTotal):'待补齐'}</strong></div><div><span>销售调整后 · CNY</span><strong>{allCostsReady&&pricing.ready?amount(pricing.finalTotal):'待补齐'}</strong></div><div><span>调整后毛利率</span><strong>{allCostsReady&&pricing.finalTotal && pricing.finalTotal>0?`${((pricing.finalTotal-pricing.costTotal)/pricing.finalTotal*100).toFixed(1)}%`:'待计算'}</strong></div></div>
        <p className="cw-agent-note">对外报价预览 · {state.quoteCurrency} {allCostsReady&&pricing.ready?amount(liveQuoteTotal):'待成本与定价'}。{state.quoteCurrency!=='CNY'&&!quoteRateReady(state)?'请先填写项目报价汇率与来源，才能确认或导出报价版。':'毛利按人民币底价计算；外币合价逐行换算后相加，避免汇总尾差。'}</p>
        {state.legacyDraftPriceRm !== null && <p className="cw-agent-note">旧版手填总价 RM {amount(state.legacyDraftPriceRm)} 已留作参考；请按当前成本和逐项报价重新确认，新报价版不会直接沿用旧总价。</p>}
        <div className="cw-pricing-scroll"><div className="cw-pricing-head"><span>成本类型 / 物料</span><span>数量</span><span>单位成本 CNY</span><span>本行系数</span><span>建议单价 CNY</span><span>销售单价 CNY</span><span>成本 / 报价合计 CNY</span><span>行毛利</span></div>
          {pricing.rows.map(row=><div className="cw-pricing-row" key={row.id}><span><strong>{row.name}</strong><small>{priceCategoryLabels[row.category]} · {row.id}{row.edited?' · 人工已调':''}</small></span><span>{row.quantity}</span><span>{amount(row.unitCost)}</span><label><input aria-label={`${row.name}本行报价系数`} type="number" min="0.01" step="0.1" disabled={role!=='销售'} value={row.factor??''} placeholder="待填写" onChange={e=>update({lineFactorOverrides:{...state.lineFactorOverrides,[row.id]:e.target.value===''?null:Math.max(0,Number(e.target.value))}})}/>{row.factorEdited&&<button type="button" disabled={role!=='销售'} onClick={()=>{const next={...state.lineFactorOverrides};delete next[row.id];update({lineFactorOverrides:next})}}>用分类系数</button>}</label><span>{amount(row.suggestedUnit)}</span><label><input aria-label={`${row.name}销售单价 CNY`} type="number" min="0" step="0.01" disabled={role!=='销售'||row.suggestedUnit===null||!allCostsReady} placeholder="待建议价" value={row.finalUnit??''} onChange={e=>update({linePriceOverrides:{...state.linePriceOverrides,[row.id]:e.target.value===''?null:Math.max(0,Number(e.target.value))}})}/>{row.priceEdited&&<button type="button" disabled={role!=='销售'} onClick={()=>{const next={...state.linePriceOverrides};delete next[row.id];update({linePriceOverrides:next})}}>恢复建议价</button>}</label><span>{amount(row.costTotal)} / {amount(row.finalTotal)}</span><span className={row.finalTotal!==null&&row.costTotal!==null&&row.finalTotal<row.costTotal?'cw-pricing-loss':''}>{row.finalTotal && row.costTotal!==null?`${((row.finalTotal-row.costTotal)/row.finalTotal*100).toFixed(1)}%`: '待算'}</span></div>)}
          {pricing.extras.map(row=><div className="cw-pricing-row" key={row.id}><span><strong>{row.name}</strong><small>补充费用{row.edited?' · 人工已调':''}</small></span><span>1 项</span><span>{amount(row.cost)}</span><span>{row.factor ?? '待填'}</span><span>{amount(row.suggested)}</span><label><input aria-label={`${row.name}销售金额 CNY`} type="number" min="0" step="0.01" disabled={role!=='销售'||row.suggested===null||!allCostsReady} value={row.final??''} onChange={e=>update({extraPriceOverrides:{...state.extraPriceOverrides,[row.id]:e.target.value===''?null:Math.max(0,Number(e.target.value))}})}/>{row.edited&&<button type="button" disabled={role!=='销售'} onClick={()=>{const next={...state.extraPriceOverrides};delete next[row.id];update({extraPriceOverrides:next})}}>恢复建议价</button>}</label><span>{amount(row.cost)} / {amount(row.final)}</span><span className={row.final!==null&&row.cost!==null&&row.final<row.cost?'cw-pricing-loss':''}>{row.final && row.cost!==null?`${((row.final-row.cost)/row.final*100).toFixed(1)}%`:'待算'}</span></div>)}
        </div>
        <p className="cw-note">表中单价可直接改，合价和毛利随之更新；单列税费不计入本表。红色毛利表示报价低于该行成本，请销售核对。</p>
      </section>
      <section className="cw-card cw-f7-finish"><div><span className="cw-eyebrow">第 7 步 · 报价版</span><h3>确认销售调整后的报价稿</h3><p className="cw-note">{!allCostsReady?'请先补齐成本版。':!pricing.ready?'请填写缺少的报价系数。':!quoteRateReady(state)?'请填写项目报价汇率与来源。':!state.pricingBasis.trim()?'请填写销售报价原则与判断。':state.quoteConfirmedAt?'当前报价版已确认；任何成本或定价修改都需要重新确认。':'建议价已生成，请销售逐项核对后确认。'}</p></div><div className="cw-finish-actions"><button className="cw-button primary" disabled={role!=='销售'||!allCostsReady||!pricing.ready||!pricing.finalTotal||pricing.finalTotal<=0||!quoteRateReady(state)||!state.pricingBasis.trim()} onClick={()=>{update({draftPriceCny:pricing.finalTotal,quoteConfirmedAt:new Date().toISOString()});setMessage('销售报价版已确认。成本版按人民币导出；报价版同时列出人民币底价和项目报价币种。')}}>确认报价版 · {state.quoteCurrency} {allCostsReady&&pricing.ready?amount(liveQuoteTotal):'待补齐'}</button><button className="cw-button" disabled={!state.quoteConfirmedAt||state.draftPriceCny===null||!allCostsReady||!quoteRateReady(state)} onClick={exportDraftQuote}><Download size={15}/>导出报价版 CSV</button></div></section>
      <section className="cw-card cw-compare"><div><GitCompareArrows size={18}/><h3>版本提醒</h3></div><p>7 月与 9 月配置分别保存。技术清单变更后，成本、换算依据和销售报价须按对应版本复核。</p></section>
    </div>}

    {stage === 'F8' && <div className="cw-f8-layout">
      <section className="cw-flow"><div className="cw-flow-title"><div><span className="cw-eyebrow">F8 · 可操作的第一版</span><h3>一项一项完成客户 BOQ 对照</h3></div><span>已核对 {boqCompleted} / {boqGroups.length} 项</span></div>
        <ol className="cw-f8-steps"><li><b>1</b><span>选客户 BOQ 分项</span></li><li><b>2</b><span>找对应的内部物料</span></li><li><b>3</b><span>写拆分规则、分配数量</span></li><li><b>4</b><span>核对金额与差异</span></li></ol>
        <p>客户要求按其 BOQ 报价时使用本流程；客户接受内部格式时可沿用 F7 已确认报价版。客户金额按 F7 选定币种填写；报价版和汇率确认后才能确认分项。当前载入客户表 S2 / S3 的 14 个选取分项，尚非完整 BOQ。系统按名称给初步匹配建议，拆分方式由销售决定，设备对应和数量差异需与技术核对。</p>
      </section>
      <div className="cw-f8-workspace">
        <aside className="cw-card cw-f8-groups"><span className="cw-eyebrow">客户 BOQ</span><h3>先选一项</h3><p className="cw-note">按客户表原有分项逐个处理。点一项即可看到右侧操作。</p><div className="cw-f8-group-list">{boqGroups.map(item=>{const review=boqGroupIssues(state,item.id,lines);const confirmed=state.mappings[item.id]?.confirmed&&review.ready;return <button key={item.id} className={group.id===item.id?'active':''} onClick={()=>{setGroupId(item.id);setBoqSearch('')}}><span><strong>{item.name}</strong><small>{item.label} · {item.sheet.startsWith('S2')?'设计与编程':'硬件与基础设施'}</small></span>{mark(confirmed?'已核对':review.selected.length?'处理中':'待处理',confirmed?'ok':review.selected.length?'warn':'bad')}</button>})}</div></aside>
        <main className="cw-f8-detail">
          <section className="cw-card"><span className="cw-eyebrow">第 1 步 · 看客户要什么</span><div className="cw-f8-detail-head"><div><h3>{group.name}</h3><p>{group.label}</p></div>{mark(map.confirmed&&boqIssues.ready?'已核对':'待核对',map.confirmed&&boqIssues.ready?'ok':'warn')}</div><p className="cw-my-work">客户表位置：{sourceAnchor(group.sheet,group.rows)}。三行分别对应一期、二期、三期；请对照客户原表核实名称、单位与数量。</p></section>
          <section className="cw-card"><span className="cw-eyebrow">第 2 步 · 找内部物料</span><h3>哪些配置行属于这个客户分项？</h3><p className="cw-note">下方是按名称初筛的建议，勾选后才进入本分项。找不到时搜索物料名或料号。柜体和柜内设备可分别勾选，由销售与技术确认对应关系。</p><div className="cw-f8-search"><label><Search size={15}/><input aria-label="搜索内部物料" value={boqSearch} onChange={e=>setBoqSearch(e.target.value)} placeholder="搜索内部物料、料号或清单 ID"/></label><button className="cw-button" disabled={!canEditBoq||newSuggestions.length===0} onClick={()=>setBoqMapping({lineIds:[...new Set([...map.lineIds,...newSuggestions])]})}>加入 {newSuggestions.length} 条初筛建议</button></div><div className="cw-f8-candidates">{boqCandidates.map(line=><label key={line.id} className={map.lineIds.includes(line.id)?'checked':''}><input type="checkbox" disabled={!canEditBoq} checked={map.lineIds.includes(line.id)} onChange={()=>toggleBoqLine(line.id)}/><span><strong>{line.name}</strong><small>{line.id} · {line.material||'料号待核'} · 内部数量 {line.quantity} {line.unit}</small></span>{suggested.includes(line.id)&&<em>初筛建议</em>}</label>)}{boqCandidates.length===0&&<p className="cw-empty">没有建议项；试着搜索内部物料名称或料号。</p>}</div><p className="cw-note">已选 {map.lineIds.length} 条。初筛建议未经工程核对，不会自动确认。</p></section>
          <section className="cw-card"><span className="cw-eyebrow">第 3 步 · 定规则、分数量</span><h3>销售先说清本项目怎么拆</h3><label className="cw-field">本分项拆分规则<textarea disabled={!canEditBoq} value={map.note} onChange={e=>setBoqMapping({note:e.target.value})} placeholder="例如：按客户一期/二期的区域和设备清单分配；柜体与柜内模块分别对应客户行。请写本项目实际依据。"/></label><p className="cw-note">下表填内部清单数量在客户三期中的去向。已在其他客户分项分配的数量也会计入超量检查。</p>{boqIssues.selected.length===0?<p className="cw-empty">先在第 2 步勾选内部物料，才会出现数量表。</p>:<div className="cw-f8-allocation"><div className="cw-f8-allocation-head"><span>内部物料</span><span>一期数量</span><span>二期数量</span><span>三期数量</span><span>检查</span></div>{boqIssues.selected.map(line=>{const qty=allocationFor(state,group.id,line.id);const totalAcross=boqGroups.reduce((sum,item)=>state.mappings[item.id]?.lineIds.includes(line.id)?sum+allocationFor(state,item.id,line.id).reduce((a,b)=>a+b,0):sum,0);const over=totalAcross>line.quantity+0.000001;const cost=state.costs[line.id];return <div className="cw-f8-allocation-row" key={line.id}><span><strong>{line.name}</strong><small>{line.id} · 可用 {line.quantity} {line.unit} · 已分配 {totalAcross}</small></span>{qty.map((value,index)=><label key={index}>{numberField(value,next=>setBoqAllocation(line.id,index,next),`${line.name} ${['一期','二期','三期'][index]}数量`,!canEditBoq)}</label>)}<span>{mark(over?'超出内部数量':qty.reduce((a,b)=>a+b,0)>0?'已分配':'待分配',over?'bad':qty.reduce((a,b)=>a+b,0)>0?'ok':'warn')}<small>可核成本 CNY {cost?.status==='confirmed'&&cost.amount!==null?amount(cost.amount*qty.reduce((a,b)=>a+b,0)):'待成本确认'}</small></span></div>})}</div>}<label className="cw-field">客户数量差异或增减项如何处理<textarea disabled={!canEditBoq} value={map.quantityNote||''} onChange={e=>setBoqMapping({quantityNote:e.target.value})} placeholder="如客户表数量与内部数量不同，在这里记录差异、处理方式和待技术确认的问题"/></label><label className="cw-field">与技术核对的结论或待确认点<textarea disabled={!canEditBoq} value={map.technicalReview||''} onChange={e=>setBoqMapping({technicalReview:e.target.value,technicalConfirmed:false})} placeholder="记录核对人、结论与依据；尚未确认时写清需要技术答复的问题"/></label><label className="cw-f8-tech-check"><input type="checkbox" disabled={!canEditBoq||!map.technicalReview?.trim()} checked={!!map.technicalConfirmed} onChange={e=>setBoqMapping({technicalConfirmed:e.target.checked})}/> 已与技术核对上述对应关系和数量处理</label></section>
          <section className="cw-card"><span className="cw-eyebrow">第 4 步 · 对金额、查差异</span><h3>把客户三期金额填回原分项</h3><p className="cw-note">一期、二期、三期对应客户表的三行；不适用的一期请明确填 0。金额由销售按 F7 已确认报价版和本项目拆分规则决定。</p><div className="cw-f8-price-grid">{(['phase1','phase2','phase3'] as const).map((phase,index)=><label className="cw-field" key={phase}>{['一期','二期','三期'][index]}客户金额 · {state.quoteCurrency}{numberField(state.quotes[group.id]?.[phase]??null,value=>setBoqQuote(phase,value),`${group.name} ${['一期','二期','三期'][index]}客户金额 ${state.quoteCurrency}`,!canEditBoq)}<small>客户表第 {group.rows[index]} 行</small></label>)}</div><div className="cw-f8-checks"><span>{mark(boqIssues.selected.length?'已选内部物料':'未选内部物料',boqIssues.selected.length?'ok':'bad')}</span><span>{mark(!boqIssues.selected.length?'待选物料':boqIssues.missingQuantity.length?`${boqIssues.missingQuantity.length} 条未分数量`:'数量已分配',!boqIssues.selected.length||boqIssues.missingQuantity.length?'bad':'ok')}</span><span>{mark(boqIssues.overAllocated.length?`${boqIssues.overAllocated.length} 条超量`:'无超量',boqIssues.overAllocated.length?'bad':'ok')}</span><span>{mark(map.note.trim()?'拆分规则已写':'缺拆分规则',map.note.trim()?'ok':'bad')}</span><span>{mark(map.technicalConfirmed?'技术已核对':'待技术核对',map.technicalConfirmed?'ok':'bad')}</span><span>{mark(boqIssues.missingAmounts?'客户金额未齐':'客户金额已填',boqIssues.missingAmounts?'bad':'ok')}</span></div><div className="cw-f8-bottom"><p className="cw-note">当前 14 项已录金额合计 {state.quoteCurrency} {hasBoqAmount?amount(quoteTotal):'待填'}；F7 已确认报价版 {state.quoteCurrency} {amount(quoteTotalDraft)}。这里只是客户表的选取分项，金额合计仅供核对，不自动改动销售报价。</p><button className="cw-button primary" disabled={!canEditBoq||!boqIssues.ready} onClick={confirmBoqGroup}>确认本分项对照结果</button></div></section>
        </main>
      </div>
      <section className="cw-card cw-f8-export"><div><span className="cw-eyebrow">输出 · 供销售继续核对</span><h3>导出 BOQ 对照草稿</h3><p className="cw-note">保留客户行位置、对应内部物料、三期数量与金额、拆分依据和未完成状态。当前还需要真实销售案例核实拆分顺序及完整客户 BOQ 范围。</p></div><button className="cw-button" onClick={exportBoqReview}><Download size={15}/>导出对照草稿 CSV</button></section>
    </div>}

    {stage === 'F9' && <div className="cw-quote">
      <div className="cw-card-head"><div><span className="cw-eyebrow">F9 · 报价与商务交接</span><h3>客户金额、毛利与 CRM 录入稿</h3></div>{readiness.ready ? mark('选定范围可交接','ok') : mark('资料未齐','bad')}</div>
      <div className="cw-quote-top"><section className="cw-card"><span className="cw-eyebrow">选定范围报价摘要 · {state.quoteCurrency}</span><strong className="cw-big">{quoteTotal ? amount(quoteTotal) : '—'}</strong><p>已填客户金额合计。{allCostsReady && quoteRateReady(state) && !issues.unmapped.length && !issues.duplicated.length && !issues.unconfirmedGroups.length ? `已确认成本 CNY ${amount(directCost + extraTotal)}，折 ${state.quoteCurrency} ${amount(toQuoteAmount(directCost+extraTotal,state))}；项目毛利 ${quoteTotal>0?`${((quoteTotal-(toQuoteAmount(directCost+extraTotal,state)||0))/quoteTotal*100).toFixed(1)}%`:'待填报价'}。` : '成本、报价汇率或数量未核齐，毛利暂不作为报价依据。'}</p></section><section className="cw-card"><span className="cw-eyebrow">交接检查</span><ul><li>缺确认成本 <b>{readiness.missingCosts.length}</b></li><li>关务 / 财务待确认 <b>{readiness.missingExtras.length}</b></li><li>F7 报价版 <b>{state.quoteConfirmedAt?'已确认':'待确认'}</b></li><li>报价汇率 <b>{quoteRateReady(state)?'已确认':'待确认'}</b></li><li>未确认 BOQ <b>{readiness.unconfirmedGroups.length}</b></li><li>未分摊 / 超量 <b>{readiness.unmapped.length} / {readiness.duplicated.length}</b></li><li>未填完整三期金额 <b>{readiness.missingPrices.length}</b></li><li>CRM 商机号 <b>{state.crmOpportunity.trim() ? '已填' : '待填'}</b></li></ul></section></div>
      <section className="cw-card cw-strategy"><span className="cw-eyebrow">销售决策 · 报价初稿</span><h3>记录价格策略和商务条件</h3><div className="cw-strategy-grid"><label className="cw-field">定价依据与毛利判断<textarea placeholder="填写客户关系、竞争情况、目标毛利与例外审批依据" value={state.pricingBasis} onChange={e=>update({pricingBasis:e.target.value})}/></label><label className="cw-field">给标书的商务条件<textarea placeholder="填写币种、贸易术语、税费口径、付款与有效期等已确认条件" value={state.businessTerms} onChange={e=>update({businessTerms:e.target.value})}/></label></div></section>
      <section className="cw-card cw-quote-table"><div className="cw-card-head"><div><h3>客户 BOQ 金额</h3><p>客户表金额栏按 Phase 1–3 填写，币种 {state.quoteCurrency}。</p></div></div>
        <div className="cw-quote-head"><span>客户分项</span><span>Phase 1</span><span>Phase 2</span><span>Phase 3</span><span>内部成本 / 毛利</span></div>
        {boqGroups.map(item => {
          const m = state.mappings[item.id]; const q = state.quotes[item.id] || {phase1:null,phase2:null,phase3:null,note:''}
          const mapped = lines.filter(line => m?.confirmed && m.lineIds.includes(line.id) && allocationFor(state,item.id,line.id).some(x=>x>0))
          const complete = mapped.length > 0 && mapped.every(line => state.costs[line.id]?.status === 'confirmed' && state.costs[line.id]?.amount !== null && !!state.costs[line.id]?.evidence) && !mapped.some(line=>issues.duplicated.some(dup=>dup.id===line.id))
          const cost = complete ? mapped.reduce((sum,line)=>sum + (state.costs[line.id]?.amount || 0)*allocationFor(state,item.id,line.id).reduce((a,b)=>a+b,0),0) : null
          const price = [q.phase1,q.phase2,q.phase3].every(x=>x!==null) ? (q.phase1||0)+(q.phase2||0)+(q.phase3||0) : null
          const quoteCost = toQuoteAmount(cost,state)
          return <div className="cw-quote-row" key={item.id}><span><strong>{item.name}</strong><small>{sourceAnchor(item.sheet,item.rows)}</small></span>{(['phase1','phase2','phase3'] as const).map((phase,i)=><label key={phase}>{numberField(q[phase],value=>setQuote(item.id,phase,value),`${item.name} Phase ${i+1} 金额 ${state.quoteCurrency}`)}</label>)}<span>{cost === null || price === null || quoteCost === null ? '待成本或汇率' : <>直接成本 CNY {amount(cost)}<br/>折 {state.quoteCurrency} {amount(quoteCost)}<br/>直接毛利 {price > 0 ? `${((price-quoteCost)/price*100).toFixed(1)}%` : '待核'}</>}</span></div>
        })}
      </section>
      <section className="cw-card cw-crm"><div className="cw-card-head"><div><span className="cw-eyebrow">商务支持 · 对外价格转内部物料</span><h3>CRM 物料号、数量、价格逐行校验</h3></div>{readiness.missingPrices.length ? mark('报价金额待补','bad') : mark(`${crmIssues.length} 个分期未平`,crmIssues.length?'bad':'ok')}</div><p className="cw-note">选客户分项后，按 Phase 给每个内部物料分配销售总价。每期内部总价必须等于客户 BOQ 金额；商务确认拆分合理性。</p><select aria-label="选择 CRM 拆分分项" value={groupId} onChange={e=>setGroupId(e.target.value)}>{boqGroups.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><div className="cw-crm-table"><div className="cw-crm-row header"><span>内部物料</span><span>CRM 料号</span><span>Phase</span><span>数量</span><span>内部销售总价 {state.quoteCurrency}</span></div>{lines.filter(line=>map.confirmed && map.lineIds.includes(line.id)).flatMap(line=>[0,1,2].filter(index=>allocationFor(state,group.id,line.id)[index]>0).map(index=><div className="cw-crm-row" key={`${line.id}-${index}`}><span><b>{line.name}</b><small>{line.id}</small></span><input aria-label={`${line.name} CRM 料号`} disabled={role!=='商务支持'} value={state.materialOverrides?.[line.id] ?? line.material} onChange={e=>update({materialOverrides:{...state.materialOverrides,[line.id]:e.target.value}})}/><span>P{index+1}</span><span>{allocationFor(state,group.id,line.id)[index]} {line.unit}</span>{numberField(state.crmPrices?.[crmPriceKey(group.id,index+1,line.id)] ?? null,value=>setCrmPrice(group.id,index+1,line.id,value),`${line.name} Phase ${index+1} 内部销售总价 {state.quoteCurrency}`,role!=='商务支持')}</div>))}</div>{!map.confirmed && <p className="cw-empty">请先在 F8 确认此分项的物料与数量。</p>}<p className="cw-hint">当前分项客户金额：{[1,2,3].map(index=>`P${index} ${amount(state.quotes[group.id]?.[`phase${index}` as 'phase1'|'phase2'|'phase3'] ?? null)}`).join(' · ')}</p></section>
      <section className="cw-card cw-handoff"><div><span className="cw-eyebrow">CRM 录入与评审</span><h3>审批版本跟踪</h3><p>记录 CRM 的真实审批状态；导出的是人工录入辅助 CSV，不会直接写入 CRM。</p><label className="cw-field">CRM 商机编号<input value={state.crmOpportunity} placeholder="录入实际商机编号" onChange={e=>update({crmOpportunity:e.target.value})}/></label><label className="cw-field">CRM 报价 / 审批单号<input disabled={role!=='商务支持'} value={state.crmApproval.reference} onChange={e=>update({crmApproval:{...state.crmApproval,reference:e.target.value,status:state.crmApproval.status==='approved'?'revision':state.crmApproval.status}})}/></label><label className="cw-field">CRM 实际状态<select disabled={role!=='商务支持'} value={state.crmApproval.status} onChange={e=>{const status=e.target.value as CommercialState['crmApproval']['status']; if(status!=='draft' && (!readiness.ready || crmIssues.length || !state.crmApproval.reference.trim())) {setMessage('请先补齐报价、内部物料分摊和 CRM 审批单号，再记录实际审批状态。');return} update({crmApproval:{...state.crmApproval,status,updatedAt:new Date().toISOString()}})}}><option value="draft">报价初稿 / 未提交</option><option value="submitted">已在 CRM 发起评审</option><option value="revision">修改 / 撤回 / 待重提</option><option value="approved">CRM 已批准</option></select></label><label className="cw-field">审批或修改记录<textarea disabled={role!=='商务支持'} value={state.crmApproval.note} onChange={e=>update({crmApproval:{...state.crmApproval,note:e.target.value}})} placeholder="记录退回原因、重提版本或批准意见"/></label></div><div className="cw-handoff-actions"><button className="cw-button primary" disabled={role!=='商务支持' || !readiness.ready || crmIssues.length>0} onClick={exportHandoff}><FileSpreadsheet size={16}/>导出 CRM 逐行录入稿</button><button className="cw-button" disabled={role!=='商务支持' || state.crmApproval.status!=='approved' || !state.crmApproval.reference.trim() || !readiness.ready || crmIssues.length>0} onClick={exportApprovedHandoff}><Download size={16}/>输出批准报价给标书</button></div></section>
      <p className="cw-hint">选定范围为客户 BMS 表 S2 / S3 的 14 个分项。项目总毛利计入已确认海外费用；分项直接毛利尚未分摊海外费用。完整报价仍需复核客户表其他范围。</p>
    </div>}
  </div>
}
