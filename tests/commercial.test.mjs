import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

function moduleUrl(file, imports = {}) {
  let code = ts.transpileModule(readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name,url] of Object.entries(imports)) code = code.replaceAll(`'${name}'`,JSON.stringify(url)).replaceAll(`"${name}"`,JSON.stringify(url))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const configUrl = moduleUrl('src/lib/configVersions.ts')
const { inventoryFor, initialCommercialState, readCommercialState, commercialReadiness, convertedAmount, importCostCsv, toCsv, parseCsv, mappingIssues, crmMappingIssues, boqGroupIssues, boqGroups, pricingBreakdown, quoteRateReady, toQuoteAmount, quotePricingTotal, quoteCurrencyPatch } = await import(moduleUrl('src/lib/commercialWorkflow.ts', {'./configVersions':configUrl}))

test('旧 RM 数据保留原币和旧总价，只有可靠的人民币原价可迁入新成本', () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem: key => key === 'presales-commercial-v2:RCJM1:20260906' ? JSON.stringify({...initialCommercialState(),draftPriceRm:12345,quoteConfirmedAt:undefined,costs:{'BMS-1':{amount:60,sourceAmount:100,sourceCurrency:'CNY',fxToRm:0.6,status:'confirmed',evidence:'CRM价格',owner:'产品',updatedAt:''},'BMS-2':{amount:50,sourceAmount:50,sourceCurrency:'RM',fxToRm:1,status:'confirmed',evidence:'供应商报价',owner:'采购',updatedAt:''}}}) : null}})
  try {
    const state = readCommercialState('RCJM1','20260906')
    assert.equal(state.draftPriceCny,null)
    assert.equal(state.legacyDraftPriceRm,12345)
    assert.equal(state.quoteCurrency,'RM')
    assert.equal(state.costs['BMS-1'].amount,100)
    assert.equal(state.costs['BMS-2'].amount,null)
    assert.equal(state.costs['BMS-2'].sourceAmount,50)
    assert.equal(state.costs['BMS-2'].status,'pending')
  } finally { if (previousStorage) Object.defineProperty(globalThis,'localStorage',previousStorage); else delete globalThis.localStorage }
})

test('人民币本位计价后按项目汇率转换对外报价，缺汇率来源不输出外币价', () => {
  const state = initialCommercialState()
  assert.equal(state.quoteCurrency,'CNY')
  assert.equal(convertedAmount(100,'CNY',null),100)
  assert.equal(convertedAmount(100,'RM',1.5),150)
  assert.equal(convertedAmount(100,'RM',Infinity),null)
  state.quoteCurrency = 'RM'
  state.quoteFxFromCny = 0.6
  assert.equal(quoteRateReady(state),false)
  assert.equal(toQuoteAmount(150,state),null)
  state.quoteFxEvidence = '财务项目汇率 2026-10-09'
  assert.equal(toQuoteAmount(150,state),90)
  state.quoteFxFromCny = Infinity
  assert.equal(quoteRateReady(state),false)
  state.quoteCurrency = 'CNY'
  assert.equal(toQuoteAmount(150,state),150)
})

test('外币报价按行折算后汇总，明细合价与总价保持一致', () => {
  const state = initialCommercialState()
  state.pricingRules.purchase = 1
  state.quoteCurrency = 'RM'
  state.quoteFxFromCny = 0.5
  state.quoteFxEvidence = '项目报价汇率'
  const lines = [{id:'A',name:'A',material:'',kind:'外购设备',quantity:1},{id:'B',name:'B',material:'',kind:'外购设备',quantity:1}]
  for (const line of lines) state.costs[line.id] = {amount:0.01,status:'confirmed',evidence:'询价',owner:'采购',updatedAt:''}
  const pricing = pricingBreakdown(state,lines)
  assert.equal(pricing.finalTotal,0.02)
  assert.equal(quotePricingTotal(state,pricing),0.02)
  assert.equal(toQuoteAmount(pricing.finalTotal,state),0.01)
})

test('切换项目报价币种时备份旧 BOQ 和 CRM 金额，旧确认状态失效', () => {
  const state = initialCommercialState()
  state.quoteCurrency = 'RM'
  state.quoteFxFromCny = 0.6
  state.quoteFxEvidence = '财务汇率'
  state.quotes.A = {phase1:100,phase2:0,phase3:0,note:''}
  state.crmPrices['A:1:line'] = 100
  state.mappings.A = {lineIds:['line'],confirmed:true,note:'原分配'}
  const patch = quoteCurrencyPatch(state,'USD','2026-10-09T00:00:00Z')
  assert.deepEqual(patch.quotes,{})
  assert.deepEqual(patch.crmPrices,{})
  assert.equal(patch.mappings.A.confirmed,false)
  assert.equal(patch.quoteCurrencyHistory[0].currency,'RM')
  assert.equal(patch.quoteCurrencyHistory[0].fxFromCny,0.6)
  assert.equal(patch.quoteCurrencyHistory[0].fxEvidence,'财务汇率')
  assert.equal(patch.quoteCurrencyHistory[0].quotes.A.phase1,100)
  assert.equal(patch.quoteFxFromCny,null)
  const ratePatch = quoteCurrencyPatch(state,'RM','2026-10-09T00:00:00Z')
  assert.deepEqual(ratePatch.quotes,{})
  assert.equal(ratePatch.quoteCurrencyHistory[0].currency,'RM')
  assert.equal(ratePatch.quoteCurrencyHistory[0].fxFromCny,0.6)
})

test('分类系数生成建议价，销售逐项改价后重算总价与毛利基数', () => {
  const inventory = inventoryFor('20260906')
  const internal = {...inventory.find(x=>x.kind==='自有产品'),quantity:2}
  const purchase = {...inventory.find(x=>x.kind==='外购设备'),quantity:3}
  const state = initialCommercialState()
  state.costs[internal.id] = {amount:100,status:'confirmed',evidence:'CRM 成本版本',owner:'产品',updatedAt:''}
  state.costs[purchase.id] = {amount:200,status:'confirmed',evidence:'供应商报价',owner:'供应链',updatedAt:''}
  state.extraCosts.packaging = {amount:50,status:'confirmed',evidence:'包装询价',reason:''}
  state.extraCosts.tax = {amount:30,status:'confirmed',evidence:'财务测算',reason:'',treatment:'separate'}
  const suggested = pricingBreakdown(state,[internal,purchase])
  assert.equal(suggested.ready,true)
  assert.equal(suggested.costTotal,850)
  assert.equal(suggested.suggestedTotal,1490)
  assert.equal(suggested.extras.length,1)
  state.lineFactorOverrides[purchase.id] = 1.5
  state.linePriceOverrides[internal.id] = 350
  state.extraPriceOverrides.packaging = 60
  const edited = pricingBreakdown(state,[internal,purchase])
  assert.equal(edited.suggestedTotal,1610)
  assert.equal(edited.finalTotal,1660)
  assert.equal(edited.editedCount,3)
  assert.equal(edited.rows.find(row=>row.id===purchase.id).factorEdited,true)
  state.linePriceOverrides[internal.id] = null
  const whileEditing = pricingBreakdown(state,[internal,purchase])
  assert.equal(whileEditing.suggestedTotal,1610)
  assert.equal(whileEditing.finalTotal,null)
  delete state.lineFactorOverrides[purchase.id]
  state.pricingRules.purchase = null
  assert.equal(pricingBreakdown(state,[internal,purchase]).ready,false)
})

test('真实配置解析保留 93 行且清单 ID 唯一，两个版本互不混用', () => {
  const latest = inventoryFor('20260906')
  const old = inventoryFor('20260720')
  assert.equal(latest.length,93)
  assert.equal(new Set(latest.map(x=>x.id)).size,latest.length)
  assert.equal(new Set(old.map(x=>x.id)).size,old.length)
  assert.equal(latest.find(x=>x.id==='BMS-1').quantity,550)
  assert.equal(old.find(x=>x.id==='BMS-1').quantity,527)
})

test('成本来源缺失和超量分摊阻止交接，未填金额不会生成虚假报价', () => {
  const lines = inventoryFor('20260906')
  const state = initialCommercialState()
  state.costs[lines[0].id] = { amount:100,status:'confirmed',evidence:'',owner:'供应链',updatedAt:'' }
  state.mappings[boqGroups[0].id] = {lineIds:[lines[0].id],confirmed:true,note:'已核对',allocations:{[lines[0].id]:[300,0,0]}}
  state.mappings[boqGroups[1].id] = {lineIds:[lines[0].id],confirmed:true,note:'已核对',allocations:{[lines[0].id]:[300,0,0]}}
  assert.equal(commercialReadiness(state,lines).ready,false)
  assert.equal(mappingIssues(state,lines).duplicated.length,1)
  assert.equal(commercialReadiness(state,lines).missingCosts.length,lines.length)
})

test('物料可跨客户分项按数量分配，CRM 内部价格须与客户金额相等', () => {
  const lines = inventoryFor('20260906')
  const line = lines.find(x=>x.id==='BMS-1')
  const state = initialCommercialState()
  state.mappings[boqGroups[0].id] = {lineIds:[line.id],confirmed:true,note:'分期核对',allocations:{[line.id]:[200,0,0]}}
  state.mappings[boqGroups[1].id] = {lineIds:[line.id],confirmed:true,note:'分期核对',allocations:{[line.id]:[350,0,0]}}
  assert.equal(mappingIssues(state,lines).duplicated.length,0)
  assert.equal(mappingIssues(state,lines).unmapped.some(x=>x.id===line.id),false)
  state.quotes[boqGroups[0].id] = {phase1:1000,phase2:0,phase3:0,note:''}
  state.crmPrices[`${boqGroups[0].id}:1:${line.id}`] = 999
  assert.ok(crmMappingIssues(state,lines).includes(`${boqGroups[0].name} · Phase 1`))
  state.crmPrices[`${boqGroups[0].id}:1:${line.id}`] = 1000
  state.materialOverrides[line.id] = 'CRM-001'
  assert.equal(crmMappingIssues(state,lines).includes(`${boqGroups[0].name} · Phase 1`),false)
})

test('财务税费必须确认处理口径，缺成本依据不能进入交接', () => {
  const lines = inventoryFor('20260906')
  const state = initialCommercialState()
  state.extraCosts.freight = {amount:500,evidence:'货代报价 A',status:'confirmed',reason:''}
  state.extraCosts.duty = {amount:200,evidence:'关务税率表',status:'confirmed',reason:''}
  state.extraCosts.tax = {amount:100,evidence:'财务测算表',status:'confirmed',reason:''}
  assert.ok(commercialReadiness(state,lines).missingExtras.some(x=>x.id==='tax'))
  state.extraCosts.tax.treatment = 'separate'
  assert.equal(commercialReadiness(state,lines).missingExtras.some(x=>x.id==='tax'),false)
  state.extraCosts.packaging = {amount:null,evidence:'',status:'notApplicable',reason:''}
  assert.ok(commercialReadiness(state,lines).missingExtras.some(x=>x.id==='packaging'))
  state.extraCosts.packaging.reason = '已包含在配置清单'
  assert.equal(commercialReadiness(state,lines).missingExtras.some(x=>x.id==='packaging'),false)
})

test('原币金额需要有效换算率，零金额与空金额保持不同', () => {
  assert.equal(convertedAmount(100,'RM',null),null)
  assert.equal(convertedAmount(100,'RM',1.5),150)
  assert.equal(convertedAmount(0,'RM',1.5),0)
  assert.equal(convertedAmount(null,'RM',1),null)
})

test('询价 CSV 支持逗号、引号和换行，拒绝错版本与无依据的确认价', () => {
  const lines = inventoryFor('20260906')
  const header = ['配置版本','清单ID','单位成本CNY','状态','依据/询价来源','建议责任方']
  const csv = toCsv([header,['20260906',lines[0].id,123.45,'confirmed','供应商 "A", 报价\nV2','供应链'],['20260720',lines[1].id,22,'confirmed','旧版报价','供应链'],['20260906',lines[2].id,33,'confirmed','','供应链']])
  assert.equal(parseCsv(csv).length,4)
  const result = importCostCsv(csv,'20260906',lines)
  assert.equal(result.count,1)
  assert.equal(result.errors.length,2)
  assert.equal(result.records[lines[0].id].evidence,'供应商 "A", 报价\nV2')
})

test('批量回填保留原币、换算率与来源，拒绝不一致的 CNY 金额', () => {
  const lines = inventoryFor('20260906')
  const header = ['配置版本','清单ID','单位成本CNY','状态','依据/询价来源','原币单位成本','原币币种','1原币折CNY','汇率来源']
  const csv = toCsv([header,
    ['20260906',lines[0].id,150,'confirmed','供应商报价 A',100,'RM',1.5,'财务汇率 2026-09-20'],
    ['20260906',lines[1].id,151,'confirmed','供应商报价 B',100,'RM',1.5,'财务汇率 2026-09-20'],
    ['20260906',lines[2].id,'','confirmed','供应商报价 C',100,'RM',1.5,''],
  ])
  const result = importCostCsv(csv,'20260906',lines)
  assert.equal(result.count,1)
  assert.equal(result.errors.length,2)
  assert.equal(result.records[lines[0].id].amount,150)
  assert.equal(result.records[lines[0].id].sourceAmount,100)
  assert.equal(result.records[lines[0].id].sourceCurrency,'RM')
  assert.equal(result.records[lines[0].id].fxEvidence,'财务汇率 2026-09-20')
})

test('批量回填保留物料号、供应商和报价版本', () => {
  const line = inventoryFor('20260906')[0]
  const csv = toCsv([
    ['配置版本','清单ID','单位成本CNY','状态','依据/询价来源','物料号','供应商名称','价格/报价版本'],
    ['20260906',line.id,123,'confirmed','供应商正式报价','CRM-001','供应商 A','报价单 Q-1，2026-10-09'],
  ])
  const record = importCostCsv(csv,'20260906',[line]).records[line.id]
  assert.equal(record.materialNumber,'CRM-001')
  assert.equal(record.supplierName,'供应商 A')
  assert.equal(record.priceReference,'报价单 Q-1，2026-10-09')
})

test('BOQ 分项核对需要物料、拆分规则、数量、技术记录和客户金额，并检查跨分项超量', () => {
  const lines = inventoryFor('20260906')
  const line = lines.find(x=>x.id==='BMS-1')
  const first = boqGroups[0].id
  const second = boqGroups[1].id
  const state = initialCommercialState()
  state.quoteConfirmedAt = '2026-10-09T00:00:00Z'
  state.mappings[first] = {lineIds:[line.id],confirmed:false,note:'按区域拆分',technicalConfirmed:true,technicalReview:'技术确认对应',allocations:{[line.id]:[300,0,0]}}
  state.quotes[first] = {phase1:1000,phase2:0,phase3:0,note:''}
  assert.equal(boqGroupIssues(state,first,lines).ready,true)
  state.mappings[second] = {lineIds:[line.id],confirmed:false,note:'二期区域',technicalConfirmed:true,technicalReview:'技术确认对应',allocations:{[line.id]:[300,0,0]}}
  assert.deepEqual(boqGroupIssues(state,first,lines).overAllocated.map(x=>x.id),[line.id])
  assert.equal(boqGroupIssues(state,first,lines).ready,false)
  state.mappings[second].allocations[line.id] = [250,0,0]
  assert.equal(boqGroupIssues(state,first,lines).ready,true)
  state.mappings[first].technicalConfirmed = false
  assert.equal(boqGroupIssues(state,first,lines).ready,false)
  state.mappings[first].technicalConfirmed = true
  state.mappings[first].technicalReview = ''
  assert.equal(boqGroupIssues(state,first,lines).ready,false)
})
