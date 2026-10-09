import type { CommercialState } from './commercialWorkflow'

export type TemplateCheck = { id: string; label: string; detail: string; ready: boolean }
const asNumber = (value: string | number | undefined) => value === '' || value === undefined ? null : typeof value === 'number' && Number.isFinite(value) ? value : Number.isFinite(Number(value)) ? Number(value) : null
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(a) * 0.00001)

export function costTemplateChecks(state: CommercialState, expectedQuoteCny: number | null = state.draftPriceCny, expectedCostCny: number | null = null, automatic?: Record<string, { value: number | null; total: number }>): TemplateCheck[] {
  const entries = state.templateEntries || {}
  const get = (ref: string) => asNumber(entries[ref])
  const checks: TemplateCheck[] = []
  const compareExtra = (id: string, label: string, calculated: number | null, source: string) => {
    const extra = state.extraCosts[id]
    if (extra?.status !== 'confirmed' || extra.amount === null) return
    checks.push({ id, label, ready: calculated !== null && close(calculated, extra.amount),
      detail: calculated === null ? `${source}尚未填写，无法对照已确认金额 CNY ${extra.amount}` : `${source} CNY ${calculated.toFixed(2)}；岗位已确认 CNY ${extra.amount.toFixed(2)}` })
  }

  const rental = get('1:F31'), localTraffic = get('1:F32')
  compareExtra('carRental','租车与日常交通',rental !== null && localTraffic !== null ? rental + localTraffic : null,'主表 F31+F32')
  const site = [get('1:F36'),get('1:F40'),get('1:F41')]
  compareExtra('siteManagement','现场管理、劳保与仓储',site.every(value=>value!==null) ? site.reduce<number>((sum,value)=>sum+value!,0) : null,'主表 F36+F40+F41')

  const months = Array.from({length:8},(_,index)=>get(`2:F${index+6}`))
  compareExtra('commissioningLabor','调试人工',months.some(value=>value!==null) ? months.reduce<number>((sum,value)=>sum+(value || 0),0)*35000 : null,'工时表 F6:F13 × 35000')
  const aftersalesRows = Array.from({length:8},(_,index)=>[get(`2:R${index+6}`),get(`2:T${index+6}`)] as const)
  const aftersalesIncomplete = aftersalesRows.some(([hours,rate])=>(hours===null)!==(rate===null))
  compareExtra('afterSales','售后与维保',!aftersalesIncomplete && aftersalesRows.some(([hours])=>hours!==null) ? aftersalesRows.reduce((sum,[hours,rate])=>sum+(hours || 0)*(rate || 0),0) : null,'工时表 R6:T13')

  const duty = state.extraCosts.duty
  if (duty?.status === 'confirmed' && duty.amount !== null) {
    const trade = entries['4:B7']
    const hardwareQuote = get('4:B12'), rate = get('4:B16')
    const calculated = trade === 'DDP' && hardwareQuote !== null && rate !== null ? hardwareQuote * rate : trade && trade !== 'DDP' ? 0 : null
    checks.push({ id:'duty', label:'关税测算', ready: calculated !== null && close(calculated,duty.amount),
      detail: calculated === null ? '税费页成交方式、硬件报价或关税率未齐，无法对照关务金额' : `税费页测算 CNY ${calculated.toFixed(2)}；关务已确认 CNY ${duty.amount.toFixed(2)}` })
  }

  const tax = state.extraCosts.tax
  if (tax?.status === 'confirmed' && tax.amount !== null && tax.treatment === 'cost') {
    const required = ['4:B5','4:B6','4:B7','4:B8','4:B12','4:B13','4:B14','4:B15','4:B16']
    const missing = required.filter(ref=>entries[ref]===undefined || entries[ref]==='')
    const taxReviewed = state.templateTaxResultCny !== null && !!state.templateTaxReviewEvidence?.trim()
    checks.push({ id:'tax-inputs', label:'财务税费测算条件与结果', ready: missing.length===0 && taxReviewed && close(state.templateTaxResultCny!,tax.amount),
      detail: missing.length ? `税费页缺 ${missing.join('、')}，Excel 税费公式暂不能核对财务金额` : !taxReviewed ? '请财务将 Excel 税费合计填回核对栏，并注明依据' : `Excel 计算 CNY ${state.templateTaxResultCny!.toFixed(2)}；财务已确认 CNY ${tax.amount.toFixed(2)}` })
  }

  const manualTotal = get('1:B7')
  const total = expectedQuoteCny ?? manualTotal
  const equipment = get('1:B8'), service = get('1:B9')
  if (total !== null) checks.push({ id:'quote-split',label:'合同设备与服务报价',ready:equipment!==null&&service!==null&&close(equipment+service,total),detail:equipment===null||service===null?'设备或服务报价尚未拆分':`设备 CNY ${equipment.toFixed(2)} + 服务 CNY ${service.toFixed(2)}；总价 CNY ${total.toFixed(2)}` })
  if (total !== null) {
    const taxParts = ['4:B12','4:B13','4:B14','4:B15'].map(get)
    checks.push({ id:'tax-quote-split',label:'税费页分项报价',ready:taxParts.every(value=>value!==null)&&close(taxParts.reduce<number>((sum,value)=>sum+(value||0),0),total),detail:taxParts.some(value=>value===null)?'硬件、软件、调试和施工四项报价尚未齐全':`四项合计 CNY ${taxParts.reduce<number>((sum,value)=>sum+(value||0),0).toFixed(2)}；合同总价 CNY ${total.toFixed(2)}` })
  }
  if (expectedQuoteCny !== null && manualTotal !== null && !state.quoteConfirmedAt) checks.push({ id:'sales-quote',label:'模板合同总报价',ready:close(manualTotal,expectedQuoteCny),detail:`模板手填 CNY ${manualTotal.toFixed(2)}；当前报价稿 CNY ${expectedQuoteCny.toFixed(2)}` })

  if (expectedCostCny !== null && automatic) {
    const rows = [14,16,17,18,20,21,22,23,24,25,26,27,29,30,31,32,33,35,36,37,38,39,40,41,42,43,44,47,48,49]
    const ordinary = rows.reduce((sum,row)=>{
      const key = `1:F${row}`
      return sum + (automatic[key]?.total ? automatic[key].value ?? 0 : get(key) ?? 0)
    },0)
    const formulaCosts = ['commissioningLabor','afterSales','duty'].reduce((sum,id)=>sum+(state.extraCosts[id]?.status==='confirmed'?state.extraCosts[id].amount||0:0),0)
    const taxCost = state.extraCosts.tax?.status==='confirmed' && state.extraCosts.tax.treatment!=='separate' ? state.extraCosts.tax.amount || 0 : 0
    const projected = ordinary + formulaCosts + taxCost
    checks.push({ id:'cost-total',label:'模板成本与工作台成本合计',ready:close(projected,expectedCostCny),detail:`模板预计成本 CNY ${projected.toFixed(2)}；工作台 CNY ${expectedCostCny.toFixed(2)}。模板公式在 Excel 打开后仍需复核` })
  }
  return checks
}
