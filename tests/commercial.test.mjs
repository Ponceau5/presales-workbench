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
const { inventoryFor, initialCommercialState, commercialReadiness, convertedAmount, importCostCsv, toCsv, parseCsv, mappingIssues, crmMappingIssues, boqGroupIssues, boqGroups } = await import(moduleUrl('src/lib/commercialWorkflow.ts', {'./configVersions':configUrl}))

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
  assert.equal(convertedAmount(100,'CNY',null),null)
  assert.equal(convertedAmount(100,'CNY',0.6),60)
  assert.equal(convertedAmount(0,'CNY',0.6),0)
  assert.equal(convertedAmount(null,'RM',1),null)
})

test('询价 CSV 支持逗号、引号和换行，拒绝错版本与无依据的确认价', () => {
  const lines = inventoryFor('20260906')
  const header = ['配置版本','清单ID','单位成本RM','状态','依据/询价来源','建议责任方']
  const csv = toCsv([header,['20260906',lines[0].id,123.45,'confirmed','供应商 "A", 报价\nV2','供应链'],['20260720',lines[1].id,22,'confirmed','旧版报价','供应链'],['20260906',lines[2].id,33,'confirmed','','供应链']])
  assert.equal(parseCsv(csv).length,4)
  const result = importCostCsv(csv,'20260906',lines)
  assert.equal(result.count,1)
  assert.equal(result.errors.length,2)
  assert.equal(result.records[lines[0].id].evidence,'供应商 "A", 报价\nV2')
})

test('批量回填保留原币、换算率与来源，拒绝不一致的 RM 金额', () => {
  const lines = inventoryFor('20260906')
  const header = ['配置版本','清单ID','单位成本RM','状态','依据/询价来源','原币单位成本','原币币种','1原币折RM','汇率来源']
  const csv = toCsv([header,
    ['20260906',lines[0].id,60,'confirmed','供应商报价 A',100,'CNY',0.6,'财务汇率 2026-09-20'],
    ['20260906',lines[1].id,61,'confirmed','供应商报价 B',100,'CNY',0.6,'财务汇率 2026-09-20'],
    ['20260906',lines[2].id,'','confirmed','供应商报价 C',100,'CNY',0.6,''],
  ])
  const result = importCostCsv(csv,'20260906',lines)
  assert.equal(result.count,1)
  assert.equal(result.errors.length,2)
  assert.equal(result.records[lines[0].id].amount,60)
  assert.equal(result.records[lines[0].id].sourceAmount,100)
  assert.equal(result.records[lines[0].id].sourceCurrency,'CNY')
  assert.equal(result.records[lines[0].id].fxEvidence,'财务汇率 2026-09-20')
})

test('BOQ 分项核对需要物料、拆分规则、数量、技术记录和客户金额，并检查跨分项超量', () => {
  const lines = inventoryFor('20260906')
  const line = lines.find(x=>x.id==='BMS-1')
  const first = boqGroups[0].id
  const second = boqGroups[1].id
  const state = initialCommercialState()
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
