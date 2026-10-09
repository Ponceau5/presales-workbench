import { roundMoney, type CostCurrency } from './commercialWorkflow'

const monetaryInput = (sheet: number, ref: string) => {
  const row = Number(ref.match(/\d+$/)?.[0])
  if (sheet === 1) return /^(B[789]|F\d+)$/.test(ref)
  if (sheet === 2) return /^T(?:[6-9]|1[0-3]|19)$/.test(ref)
  if (sheet === 3) return ref === 'F6' || /^[B-K]\d+$/.test(ref) && row >= 11 && row <= 25
  if (sheet === 4) return /^B(?:1[2-5]|26)$/.test(ref)
  if (sheet === 7) return /^C\d+$/.test(ref) && (row >= 8 && row <= 10 || row >= 27 && row <= 66)
  return false
}

const perUnitInput = (sheet: number, ref: string) =>
  (sheet === 2 && /^T(?:[6-9]|1[0-3]|19)$/.test(ref)) ||
  (sheet === 7 && /^C(?:2[7-9]|[3-5]\d|6[0-6])$/.test(ref))

export function costTemplateCurrencyIssues(inputs: Record<string, string | number>, currency: CostCurrency) {
  if (currency === 'CNY') return []
  return Array.from({ length: 40 }, (_, index) => index + 27).filter(row => {
    const price = inputs[`7:C${row}`]
    const sourceCurrency = inputs[`7:E${row}`]
    return price !== undefined && price !== '' && sourceCurrency !== undefined && sourceCurrency !== '' && sourceCurrency !== 'CNY'
  }).map(row => `清关物料第 ${row - 26} 行（E${row}）须先折成人民币，再生成${currency}成本版`)
}

export function costTemplateInCurrency(inputs: Record<string, string | number>, currency: CostCurrency, fxFromCny: number | null) {
  if (currency === 'CNY') return { ...inputs, '1:F7': 'CNY' }
  if (fxFromCny === null || !Number.isFinite(fxFromCny) || fxFromCny <= 0) throw new Error('请先填写有效的人民币折外币汇率')
  const issues = costTemplateCurrencyIssues(inputs, currency)
  if (issues.length) throw new Error(issues[0])
  const converted: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const [rawSheet, ref] = key.split(':')
    const sheet = Number(rawSheet)
    if (typeof value === 'number' && monetaryInput(sheet, ref)) {
      converted[key] = perUnitInput(sheet, ref) ? Number((value * fxFromCny).toFixed(6)) : roundMoney(value * fxFromCny)
    } else converted[key] = value
  }
  converted['1:F7'] = currency
  for (let row = 27; row <= 66; row++) {
    if (inputs[`7:C${row}`] !== undefined && inputs[`7:C${row}`] !== '') converted[`7:E${row}`] = currency
  }
  return converted
}
