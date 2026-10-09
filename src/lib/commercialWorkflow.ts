import { configVersions } from './configVersions'

export type Baseline = '20260720' | '20260906'
export type CostStatus = 'pending' | 'estimate' | 'confirmed'
export type CostCurrency = 'RM' | 'CNY' | 'USD'
export type CostRecord = { amount: number | null; status: CostStatus; evidence: string; owner: string; updatedAt: string; sourceAmount?: number | null; sourceCurrency?: CostCurrency; fxToRm?: number | null; fxEvidence?: string }
export type PhaseQuantities = [number, number, number]
export type MappingRecord = { lineIds: string[]; confirmed: boolean; note: string; technicalConfirmed?: boolean; technicalReview?: string; quantityNote?: string; allocations?: Record<string, PhaseQuantities> }
export type QuoteRecord = { phase1: number | null; phase2: number | null; phase3: number | null; note: string }
export type CostRoute = 'sales' | 'internal' | 'purchase' | 'software' | 'project' | 'customs' | 'finance'
export type PriceCategory = 'internal' | 'purchase' | 'software' | 'project' | 'extras'
export type PricingRules = Record<PriceCategory, number | null>
export const defaultPricingRules = (): PricingRules => ({ internal: 3.3, purchase: 1.3, software: null, project: null, extras: 1 })
export type CostRequest = { route: CostRoute; sentAt: string; remindedAt: string; reminderCount: number; channel: string; note: string }
export type ExtraCost = { amount: number | null; evidence: string; status: 'pending' | 'estimate' | 'confirmed' | 'notApplicable'; reason: string; treatment?: 'cost' | 'separate'; sourceAmount?: number | null; sourceCurrency?: CostCurrency; fxToRm?: number | null; fxEvidence?: string }
export const extraCostDefinitions = [
  { id: 'factoryAcceptance', name: '客户厂验费用', owner: '销售', route: 'sales', template: '主表 37 行' },
  { id: 'packaging', name: '出口包装费', owner: '销售', route: 'sales', template: '主表 43 行' },
  { id: 'capital', name: '资金成本', owner: '销售 / 财务', route: 'sales', template: '主表 47 行' },
  { id: 'fxReserve', name: '外汇成本预留', owner: '销售 / 财务', route: 'sales', template: '主表 48 行' },
  { id: 'panelAssembly', name: '组屏成本', owner: '组屏部', route: 'internal', template: '主表 18 行' },
  { id: 'commissioningLabor', name: '调试人工', owner: '用服 / BA 交付', route: 'project', template: '主表 28 行 / 工时表' },
  { id: 'travel', name: '往返交通', owner: '用服 / BA 交付', route: 'project', template: '主表 29 行' },
  { id: 'accommodation', name: '住宿', owner: '用服 / BA 交付', route: 'project', template: '主表 30 行' },
  { id: 'carRental', name: '租车与日常交通', owner: '用服 / BA 交付', route: 'project', template: '主表 31–32 行' },
  { id: 'design', name: '设计费用', owner: '项目团队 / 设计院', route: 'project', template: '主表 33 行' },
  { id: 'afterSales', name: '售后 / 维保', owner: '售后团队', route: 'project', template: '主表 34 行 / 工时表' },
  { id: 'visa', name: '签证费用', owner: '交付 / 行政', route: 'project', template: '主表 35 行' },
  { id: 'siteManagement', name: '现场管理、劳保及仓储', owner: '项目经理', route: 'project', template: '主表 36、40–41 行' },
  { id: 'localization', name: '资料翻译与本地化', owner: '项目经理', route: 'project', template: '主表 42 行' },
  { id: 'freight', name: '物流 / 运费', owner: '货运关务', route: 'customs' },
  { id: 'clearance', name: '报关 / 清关费用', owner: '货运关务', route: 'customs', template: '主表 38 行 / 清关表' },
  { id: 'duty', name: '关税', owner: '货运关务', route: 'customs' },
  { id: 'tax', name: '相关税费', owner: '财务 / 风控', route: 'finance' },
  { id: 'insurance', name: '出口信用保险', owner: '财务 / 风控', route: 'finance', template: '主表 49 行' },
] as const
export type CommercialState = {
  baseline: Baseline
  costs: Record<string, CostRecord>
  mappings: Record<string, MappingRecord>
  quotes: Record<string, QuoteRecord>
  crmPrices: Record<string, number | null>
  materialOverrides: Record<string, string>
  requests: Partial<Record<CostRoute, CostRequest>>
  extraCosts: Record<string, ExtraCost>
  pricingBasis: string
  pricingRules: PricingRules
  lineFactorOverrides: Record<string, number | null>
  linePriceOverrides: Record<string, number | null>
  extraPriceOverrides: Record<string, number | null>
  draftPriceRm: number | null
  quoteConfirmedAt: string
  legacyDraftPriceRm: number | null
  businessTerms: string
  crmApproval: { status: 'draft' | 'submitted' | 'revision' | 'approved'; reference: string; note: string; updatedAt: string }
  crmOpportunity: string
  updatedAt: string
}
export type InventoryLine = {
  id: string; sheet: string; sn: string; name: string; spec: string; brand: string
  unit: string; quantity: number; material: string; section: string; kind: string; owner: string
}

const source = [
  { id: '20260720' as Baseline, index: 0 },
  { id: '20260906' as Baseline, index: 1 },
]
export const sourceFile = (baseline: Baseline) => configVersions[source.find(x => x.id === baseline)!.index].file
export const initialCommercialState = (): CommercialState => ({
  baseline: '20260906', costs: {}, mappings: {}, quotes: {}, crmPrices: {}, materialOverrides: {}, requests: {}, extraCosts: {}, pricingBasis: '', pricingRules: defaultPricingRules(), lineFactorOverrides: {}, linePriceOverrides: {}, extraPriceOverrides: {}, draftPriceRm: null, quoteConfirmedAt: '', legacyDraftPriceRm: null, businessTerms: '',
  crmApproval: { status: 'draft', reference: '', note: '', updatedAt: '' }, crmOpportunity: '', updatedAt: '',
})
export function activeCommercialBaseline(projectId: string): Baseline {
  try {
    const value = localStorage.getItem(`presales-commercial-active:${projectId}`)
    if (value === '20260720' || value === '20260906') return value
  } catch { /* storage unavailable */ }
  return '20260906'
}
export function readCommercialState(projectId: string, baseline: Baseline = activeCommercialBaseline(projectId)): CommercialState {
  try {
    const raw = localStorage.getItem(`presales-commercial-v2:${projectId}:${baseline}`)
    if (raw) {
      const data = JSON.parse(raw) as CommercialState
      if (data.baseline === baseline) return { ...initialCommercialState(), ...data, draftPriceRm: data.quoteConfirmedAt ? data.draftPriceRm : null, legacyDraftPriceRm: data.legacyDraftPriceRm ?? (!data.quoteConfirmedAt ? data.draftPriceRm : null), pricingRules: { ...defaultPricingRules(), ...data.pricingRules }, lineFactorOverrides: data.lineFactorOverrides || {}, linePriceOverrides: data.linePriceOverrides || {}, extraPriceOverrides: data.extraPriceOverrides || {} }
    }
  } catch { /* storage unavailable */ }
  return { ...initialCommercialState(), baseline }
}

function costKind(name: string, section: string, brand: string) {
  const value = name.toLowerCase()
  if (/软件|授权|license|software/.test(value)) return ['软件', '软件支持']
  if (/施工|调试|设计|服务(?!器)|维保|交通|措施费用|management|construction|debugging/.test(value)) return ['实施服务', '项目经理']
  if (/线缆|网线|光纤|跳线|套管|桥架|线槽|辅料|cable|fibre/.test(value)) return ['施工材料', '项目经理']
  if (/^软件|软件|license/i.test(section) && /^(?:系统|平台|许可)/.test(value)) return ['软件', '软件支持']
  if (/^cet|cet成套/i.test(brand)) return ['自有产品', '销售 / 产品']
  return ['外购设备', '供应链']
}

export function inventoryFor(baseline: Baseline): InventoryLine[] {
  const version = configVersions[source.find(x => x.id === baseline)!.index]
  const result: InventoryLine[] = []
  for (const sheet of version.sheets.filter(x => x.name === 'BMS' || x.name === 'DCOM')) {
    let section = ''
    const seen = new Map<string, number>()
    for (const raw of sheet.content.split('\n')) {
      const cells = raw.split('|').map(x => x.trim())
      if (!/^\d+$/.test(cells[0] || '')) {
        if (!cells[0] && cells[1] && cells[1].length < 90) section = cells[1]
        continue
      }
      const recent = baseline === '20260906' && sheet.name === 'BMS'
      const quantity = Number(cells[recent ? 5 : 6])
      if (!Number.isFinite(quantity) || quantity <= 0) continue
      const name = cells[1] || cells[2]?.slice(0, 42) || `第 ${cells[0]} 项`
      const brand = cells[3] || ''
      const [kind, owner] = costKind(name, section, brand)
      const occurrence = (seen.get(cells[0]) || 0) + 1
      seen.set(cells[0], occurrence)
      result.push({
        id: `${sheet.name}-${cells[0]}${occurrence > 1 ? `-${occurrence}` : ''}`, sheet: sheet.name, sn: cells[0], name,
        spec: cells[2] || '', brand, unit: cells[recent ? 4 : 5] || '项',
        quantity, material: cells[recent ? 6 : 7] || '', section, kind, owner,
      })
    }
  }
  return result
}

// 仅保留客户工作簿的分项名称及单元格定位；没有复制原始工作簿或填入虚构金额。
export const boqGroups = [
  { id: 'HW-CONTROLLER', name: 'Network Controller', label: '网络控制器', sheet: 'S3 - Hardware & Infrastructure', rows: [107,108,109], terms: /网关|控制器|gateway|controller/i },
  { id: 'HW-PANEL', name: 'DDC Panel', label: 'DDC 控制柜与柜内模块', sheet: 'S3 - Hardware & Infrastructure', rows: [110,111,112], terms: /通讯箱|控制箱|模块|电源|机柜|继电器|panel/i },
  { id: 'HW-PLC', name: 'PLC Panel', label: 'PLC 控制柜', sheet: 'S3 - Hardware & Infrastructure', rows: [113,114,115], terms: /PLC|DI模块|DO模块|AI模块|AO模块/i },
  { id: 'HW-NETWORK', name: 'Server Cabinets & Network', label: '服务器、交换机及网络附件', sheet: 'S3 - Hardware & Infrastructure', rows: [116,117,118], terms: /服务器|工作站|交换机|配线架|光模块|server|network|显示器|打印机|操作系统|音响/i },
  { id: 'HW-FIBRE', name: 'Fibre Infrastructure', label: '光纤布线', sheet: 'S3 - Hardware & Infrastructure', rows: [121,122,123], terms: /光纤|光模块|fibre/i },
  { id: 'HW-CAT6', name: 'Cat 6 Infrastructure', label: '六类布线', sheet: 'S3 - Hardware & Infrastructure', rows: [124,125,126], terms: /网线|跳线|水晶头|线槽|套管|吊杆|施工辅料|施工服务|cable/i },
  { id: 'HW-WIRING', name: 'High / Low Level Wiring', label: '高低位线缆', sheet: 'S3 - Hardware & Infrastructure', rows: [130,131,132], terms: /通信线缆|控制线缆|电源线|wiring/i },
  { id: 'HW-SENSOR', name: 'Temperature & Humidity Sensor', label: '温湿度传感器', sheet: 'S3 - Hardware & Infrastructure', rows: [136,137,138], terms: /温湿度|气象站|temperature/i },
  { id: 'HW-PRESSURE', name: 'Differential Pressure Sensor', label: '压差传感器', sheet: 'S3 - Hardware & Infrastructure', rows: [139,140,141], terms: /压差|pressure/i },
  { id: 'SW-BMS', name: 'BMS Software Licensing', label: 'BMS 软件授权', sheet: 'S2 - Design & Programming', rows: [113,114,115], terms: /软件|授权|license|software/i },
  { id: 'SW-PROGRAM', name: 'BMS Programming', label: 'BMS 编程', sheet: 'S2 - Design & Programming', rows: [116,117,118], terms: /画面|接口|programming/i },
  { id: 'SERVICE-DESIGN', name: 'Design Development', label: '深化设计', sheet: 'S2 - Design & Programming', rows: [106,107,108], terms: /设计|design/i },
  { id: 'SERVICE-COMMISSION', name: 'Testing & Commissioning', label: '系统调试', sheet: 'S2 - Design & Programming', rows: [136,137,138], terms: /调试|施工服务|service|debugging/i },
  { id: 'SERVICE-MAINT', name: 'Servicing & Maintenance', label: '服务与维保', sheet: 'S2 - Design & Programming', rows: [142,143,144], terms: /维保|maintenance/i },
] as const

export function suggestedLines(group: typeof boqGroups[number], lines: InventoryLine[]) {
  return lines.filter(line => group.terms.test(`${line.name} ${line.section}`)).map(line => line.id)
}

export function routeFor(line: InventoryLine): CostRoute {
  if (line.kind === '自有产品') return 'internal'
  if (line.kind === '软件') return 'software'
  if (line.kind === '实施服务' || line.kind === '施工材料') return 'project'
  return 'purchase'
}

export function priceCategoryFor(line: InventoryLine): Exclude<PriceCategory, 'extras'> {
  const route = routeFor(line)
  return route === 'internal' || route === 'software' || route === 'project' ? route : 'purchase'
}

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function pricingBreakdown(state: CommercialState, lines: InventoryLine[]) {
  const rows = lines.map(line => {
    const cost = state.costs[line.id]
    const category = priceCategoryFor(line)
    const unitCost = cost?.status === 'confirmed' && cost.amount !== null ? cost.amount : null
    const factorOverride = state.lineFactorOverrides?.[line.id]
    const factor = factorOverride !== undefined ? factorOverride : state.pricingRules?.[category]
    const suggestedUnit = unitCost !== null && factor !== null && factor !== undefined && Number.isFinite(factor) && factor > 0 ? roundMoney(unitCost * factor) : null
    const override = state.linePriceOverrides?.[line.id]
    const finalUnit = suggestedUnit === null ? null : override !== undefined ? override : suggestedUnit
    return { id: line.id, name: line.name, material: line.material, category, quantity: line.quantity, unitCost, factor, factorEdited: factorOverride !== undefined, priceEdited: override !== undefined, suggestedUnit, finalUnit, costTotal: unitCost === null ? null : roundMoney(unitCost * line.quantity), suggestedTotal: suggestedUnit === null ? null : roundMoney(suggestedUnit * line.quantity), finalTotal: finalUnit === null ? null : roundMoney(finalUnit * line.quantity), edited: factorOverride !== undefined || override !== undefined }
  })
  const extras = extraCostDefinitions.filter(item => state.extraCosts?.[item.id]?.status === 'confirmed' && state.extraCosts[item.id].treatment !== 'separate').map(item => {
    const cost = state.extraCosts[item.id].amount
    const factor = state.pricingRules?.extras
    const suggested = cost !== null && factor !== null && factor !== undefined && Number.isFinite(factor) && factor > 0 ? roundMoney(cost * factor) : null
    const override = state.extraPriceOverrides?.[item.id]
    return { id: item.id, name: item.name, cost, factor, suggested, final: suggested === null ? null : override !== undefined ? override : suggested, edited: override !== undefined }
  })
  const suggestedReady = rows.every(row => row.suggestedTotal !== null) && extras.every(row => row.suggested !== null)
  const ready = rows.every(row => row.finalTotal !== null) && extras.every(row => row.final !== null)
  const costTotal = roundMoney(rows.reduce((sum, row) => sum + (row.costTotal || 0), 0) + extras.reduce((sum, row) => sum + (row.cost || 0), 0))
  const suggestedTotal = suggestedReady ? roundMoney(rows.reduce((sum, row) => sum + (row.suggestedTotal || 0), 0) + extras.reduce((sum, row) => sum + (row.suggested || 0), 0)) : null
  const finalTotal = ready ? roundMoney(rows.reduce((sum, row) => sum + (row.finalTotal || 0), 0) + extras.reduce((sum, row) => sum + (row.final || 0), 0)) : null
  return { rows, extras, ready, costTotal, suggestedTotal, finalTotal, editedCount: rows.filter(row => row.edited).length + extras.filter(row => row.edited).length }
}

export function allocatedQuantity(mapping: MappingRecord | undefined, lineId: string) {
  const values = mapping?.allocations?.[lineId] || [0, 0, 0]
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

export function allocationFor(state: CommercialState, groupId: string, lineId: string): PhaseQuantities {
  return state.mappings[groupId]?.allocations?.[lineId] || [0, 0, 0]
}

export function boqGroupIssues(state: CommercialState, groupId: string, lines: InventoryLine[]) {
  const mapping = state.mappings[groupId]
  const selected = lines.filter(line => mapping?.lineIds.includes(line.id))
  const missingQuantity = selected.filter(line => allocatedQuantity(mapping, line.id) <= 0)
  const overAllocated = selected.filter(line => boqGroups.reduce((sum, group) => state.mappings[group.id]?.lineIds.includes(line.id) ? sum + allocatedQuantity(state.mappings[group.id], line.id) : sum, 0) > line.quantity + 0.000001)
  const quote = state.quotes[groupId]
  const missingAmounts = !quote || [quote.phase1, quote.phase2, quote.phase3].some(value => value === null)
  return {
    selected, missingQuantity, overAllocated, missingAmounts,
    ready: selected.length > 0 && missingQuantity.length === 0 && overAllocated.length === 0 && !!mapping?.note.trim() && !!mapping?.technicalConfirmed && !!mapping?.technicalReview?.trim() && !missingAmounts,
  }
}

export function crmPriceKey(groupId: string, phase: number, lineId: string) { return `${groupId}:${phase}:${lineId}` }

export function crmMappingIssues(state: CommercialState, lines: InventoryLine[]) {
  const problems: string[] = []
  for (const group of boqGroups) {
    const mapping = state.mappings[group.id]
    const quote = state.quotes[group.id]
    if (!mapping?.confirmed || !quote) continue
    for (let phase = 0; phase < 3; phase++) {
      const total = quote[`phase${phase + 1}` as keyof QuoteRecord] as number | null
      if (total === null) continue
      const entries = lines.filter(line => mapping.lineIds.includes(line.id) && allocationFor(state, group.id, line.id)[phase] > 0)
      const priced = entries.map(line => state.crmPrices?.[crmPriceKey(group.id, phase + 1, line.id)])
      const sum = priced.reduce<number>((value, part) => value + (part || 0), 0)
      if ((total > 0 && !entries.length) || priced.some(value => value === null || value === undefined) || Math.abs(sum - total) > 0.01 || entries.some(line => !(state.materialOverrides?.[line.id] || line.material).trim())) problems.push(`${group.name} · Phase ${phase + 1}`)
    }
  }
  return problems
}

export function mappingIssues(state: CommercialState, lines: InventoryLine[]) {
  const ids = new Set(lines.map(line => line.id))
  const allocated = new Map<string, number>()
  for (const group of boqGroups) {
    const mapping = state.mappings[group.id]
    if (!mapping?.confirmed) continue
    for (const id of mapping.lineIds.filter(id => ids.has(id))) allocated.set(id, (allocated.get(id) || 0) + allocatedQuantity(mapping, id))
  }
  return {
    unmapped: lines.filter(line => (allocated.get(line.id) || 0) < line.quantity - 0.000001),
    duplicated: lines.filter(line => (allocated.get(line.id) || 0) > line.quantity + 0.000001),
    unconfirmedGroups: boqGroups.filter(group => !state.mappings[group.id]?.confirmed),
  }
}

export function commercialReadiness(state: CommercialState, lines: InventoryLine[]) {
  const missingCosts = lines.filter(line => {
    const cost = state.costs[line.id]
    return !cost || cost.status !== 'confirmed' || cost.amount === null || !cost.evidence.trim() || (cost.sourceCurrency && cost.sourceCurrency !== 'RM' && (!cost.fxToRm || cost.fxToRm <= 0 || !cost.fxEvidence?.trim()))
  })
  const issues = mappingIssues(state, lines)
  const missingPrices = boqGroups.filter(group => {
    const quote = state.quotes[group.id]
    return !quote || [quote.phase1, quote.phase2, quote.phase3].some(x => x === null)
  })
  const missingExtras = extraCostDefinitions.filter(item => {
    const extra = state.extraCosts?.[item.id]
    return !extra || (extra.status !== 'notApplicable' && (extra.status !== 'confirmed' || extra.amount === null || !extra.evidence.trim() || (extra.sourceCurrency && extra.sourceCurrency !== 'RM' && (!extra.fxToRm || extra.fxToRm <= 0 || !extra.fxEvidence?.trim())) || (item.id === 'tax' && !extra.treatment))) || (extra.status === 'notApplicable' && !extra.reason.trim())
  })
  return {
    missingCosts, missingPrices, missingExtras, ...issues,
    ready: missingCosts.length === 0 && missingPrices.length === 0 && missingExtras.length === 0 && issues.unmapped.length === 0 && issues.duplicated.length === 0 && issues.unconfirmedGroups.length === 0 && !!state.crmOpportunity.trim() && !!state.pricingBasis.trim() && !!state.businessTerms.trim(),
  }
}

export function amount(value: number | null) {
  return value === null ? '待补' : new Intl.NumberFormat('en-MY', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)
}

export function convertedAmount(sourceAmount: number | null, currency: CostCurrency, fxToRm: number | null) {
  if (sourceAmount === null) return null
  if (currency === 'RM') return sourceAmount
  return fxToRm && fxToRm > 0 ? Math.round(sourceAmount * fxToRm * 100) / 100 : null
}

export function csvEscape(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

export function toCsv(rows: unknown[][]) { return '\uFEFF' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n') }

export function parseCsv(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (ch === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++
      row.push(cell); if (row.some(x => x)) rows.push(row)
      row = []; cell = ''
    } else cell += ch
  }
  if (quoted) throw new Error('CSV 引号不完整')
  row.push(cell); if (row.some(x => x)) rows.push(row)
  return rows
}

export function importCostCsv(input: string, baseline: Baseline, lines: InventoryLine[]) {
  const rows = parseCsv(input)
  const header = rows[0] || []
  const required = ['配置版本','清单ID','单位成本RM','状态','依据/询价来源']
  const missing = required.filter(name => !header.includes(name))
  if (missing.length) throw new Error(`缺少列：${missing.join('、')}`)
  const column = (row: string[], name: string) => (row[header.indexOf(name)] || '').trim()
  const validIds = new Set(lines.map(line => line.id))
  const records: Record<string, CostRecord> = {}
  const errors: string[] = []
  const seen = new Set<string>()
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i], id = column(row,'清单ID'), raw = column(row,'单位成本RM'), rawSource = column(row,'原币单位成本')
    if (!id || (!raw && !rawSource)) continue
    if (seen.has(id)) { errors.push(`第 ${i + 1} 行：清单ID重复 ${id}`); continue }
    seen.add(id)
    if (column(row,'配置版本') !== baseline) { errors.push(`第 ${i + 1} 行：配置版本不一致`); continue }
    if (!validIds.has(id)) { errors.push(`第 ${i + 1} 行：未知清单ID ${id}`); continue }
    const currency = (column(row,'原币币种') || 'RM') as CostCurrency
    if (!['RM','CNY','USD'].includes(currency)) { errors.push(`第 ${i + 1} 行：原币币种无效`); continue }
    const sourceAmount = Number(rawSource || raw)
    const fxToRm = currency === 'RM' ? 1 : Number(column(row,'1原币折RM'))
    const fxEvidence = column(row,'汇率来源')
    const amount = convertedAmount(sourceAmount,currency,fxToRm)
    if (!Number.isFinite(sourceAmount) || sourceAmount < 0 || amount === null || !Number.isFinite(amount)) { errors.push(`第 ${i + 1} 行：原币金额或换算率无效`); continue }
    if (currency !== 'RM' && !fxEvidence) { errors.push(`第 ${i + 1} 行：缺少汇率来源`); continue }
    if (raw && (!Number.isFinite(Number(raw)) || Math.abs(Number(raw)-amount)>0.01)) { errors.push(`第 ${i + 1} 行：单位成本 RM 与原币换算不一致`); continue }
    const status = column(row,'状态')
    if (status !== 'estimate' && status !== 'confirmed') { errors.push(`第 ${i + 1} 行：状态需填 estimate 或 confirmed`); continue }
    const evidence = column(row,'依据/询价来源')
    if (!evidence) { errors.push(`第 ${i + 1} 行：缺少成本依据`); continue }
    records[id] = { amount, sourceAmount, sourceCurrency: currency, fxToRm, fxEvidence, status, evidence, owner: column(row,'建议责任方') || lines.find(x=>x.id===id)!.owner, updatedAt: new Date().toISOString() }
  }
  return { records, errors, count: Object.keys(records).length }
}
