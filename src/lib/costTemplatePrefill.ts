import { extraCostDefinitions, inventoryFor, type CommercialState, type InventoryLine } from './commercialWorkflow'

export type TemplateAutoCell = {
  value: number | null
  confirmed: number
  total: number
  pending: string[]
  sources: string[]
  conflict: boolean
  notApplicable: boolean
}

type Contribution = { name: string; amount: number | null; ready: boolean; notApplicable?: boolean; kind: 'line' | 'extra' }

const extraCells: Record<string, string[]> = {
  panelAssembly: ['1:F18'], factoryAcceptance: ['1:F37'], packaging: ['1:F43'], capital: ['1:F47'], fxReserve: ['1:F48'],
  travel: ['1:F29'], accommodation: ['1:F30'], design: ['1:F33'], visa: ['1:F35'], localization: ['1:F42'], otherOperating: ['1:F44'],
  clearance: ['1:F38','7:C9'], freight: ['1:F39','7:C8'], duty: ['7:C10'], insurance: ['1:F49'],
}

// Only map a configured item when its destination in the source template is unambiguous.
export function templateCellForLine(line: Pick<InventoryLine, 'kind' | 'name'>) {
  const name = line.name.toLowerCase()
  if (line.kind === '软件') return '1:F27'
  if (line.kind === '自有产品' && /软件|操作系统|接口|gui|画面|\bos\b/.test(name)) return null
  if (line.kind === '施工材料' || /施工辅料/.test(name)) return '1:F16'
  if (line.kind === '实施服务') {
    if (/施工服务/.test(name)) return '1:F17'
    if (/深化设计/.test(name)) return '1:F33'
    return null
  }
  if (line.kind === '自有产品') return '1:F14'
  if (line.kind !== '外购设备') return null
  if (/软件|操作系统|software|license|\bos\b/.test(name)) return null
  if (/服务器|\bserver\b/.test(name)) return '1:F20'
  if (/交换机|网关|\bswitch\b|\bgateway\b/.test(name)) return '1:F21'
  if (/控制柜|\bplc\b/.test(name)) return '1:F22'
  if (/流量计/.test(name)) return '1:F23'
  if (/\bict\b/.test(name)) return '1:F24'
  if (/安防|视频|门禁|电子围栏/.test(name)) return '1:F25'
  return '1:F26'
}

function validMoney(amount: number | null, evidence: string, sourceCurrency?: string, fxToCny?: number | null, fxEvidence?: string) {
  return amount !== null && Number.isFinite(amount) && amount >= 0 && !!evidence.trim() &&
    (!sourceCurrency || sourceCurrency === 'CNY' || (!!fxToCny && fxToCny > 0 && !!fxEvidence?.trim()))
}

export function costTemplatePrefill(state: CommercialState) {
  const grouped = new Map<string, Contribution[]>()
  const unassigned: string[] = []
  const unassignedLines: { id: string; name: string; amount: number }[] = []
  const add = (key: string, item: Contribution) => grouped.set(key, [...(grouped.get(key) || []), item])

  if (state.quoteConfirmedAt && state.draftPriceCny !== null) {
    add('1:B7', { name: '销售已确认的人民币报价', amount: state.draftPriceCny, ready: true, kind: 'extra' })
  }

  for (const line of inventoryFor(state.baseline)) {
    const record = state.costs[line.id]
    const ready = !!record && record.status === 'confirmed' && validMoney(record.amount, record.evidence, record.sourceCurrency, record.fxToCny, record.fxEvidence)
    const key = state.templateCategoryOverrides?.[line.id] || templateCellForLine(line)
    if (!key) {
      if (ready) {
        unassigned.push(`${line.name}：已确认成本，需销售按项目实际拆入模板；先核对是否与补充费用重复`)
        unassignedLines.push({ id: line.id, name: line.name, amount: record!.amount! * line.quantity })
      }
      continue
    }
    add(key, { name: `${line.name}（${line.owner}）`, amount: ready ? record!.amount! * line.quantity : null, ready, kind: 'line' })
  }
  for (const definition of extraCostDefinitions) {
    const record = state.extraCosts[definition.id]
    const keys = extraCells[definition.id]
    const notApplicable = record?.status === 'notApplicable' && !!record.reason.trim()
    const ready = !!record && record.status === 'confirmed' && validMoney(record.amount, record.evidence, record.sourceCurrency, record.fxToCny, record.fxEvidence)
    if (!keys) continue
    for (const key of keys) add(key, { name: `${definition.name}（${definition.owner}）`, amount: ready ? record!.amount : null, ready, notApplicable, kind: 'extra' })
  }

  const cells: Record<string, TemplateAutoCell> = {}
  for (const [key, items] of grouped) {
    const confirmed = items.filter(item => item.ready)
    const conflict = confirmed.some(item => item.kind === 'line') && confirmed.some(item => item.kind === 'extra')
    cells[key] = {
      value: confirmed.length && !conflict ? confirmed.reduce((sum, item) => sum + item.amount!, 0) : null,
      confirmed: confirmed.length,
      total: items.length,
      pending: items.filter(item => !item.ready && !item.notApplicable).map(item => item.name),
      sources: confirmed.map(item => item.name),
      conflict,
      notApplicable: items.every(item => item.notApplicable),
    }
  }
  return { cells, unassigned, unassignedLines }
}
