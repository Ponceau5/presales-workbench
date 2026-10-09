import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/lib/costTemplateChecks.ts','utf8')
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const { costTemplateChecks } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const base = () => ({ templateEntries:{},extraCosts:{},templateTaxResultCny:null,templateTaxReviewEvidence:'',draftPriceCny:null,quoteConfirmedAt:'' })

test('岗位总额必须与工时、拆分和税费条件一致才能通过模板核对', () => {
  const state = base()
  state.extraCosts.carRental = { status:'confirmed',amount:500 }
  state.extraCosts.commissioningLabor = { status:'confirmed',amount:70000 }
  state.extraCosts.duty = { status:'confirmed',amount:100 }
  let issues = costTemplateChecks(state).filter(item=>!item.ready)
  assert.deepEqual(issues.map(item=>item.id),['carRental','commissioningLabor','duty'])
  Object.assign(state.templateEntries,{ '1:F31':300,'1:F32':200,'2:F6':2,'4:B7':'DDP','4:B12':1000,'4:B16':0.1 })
  issues = costTemplateChecks(state).filter(item=>!item.ready)
  assert.deepEqual(issues,[])
  state.templateEntries['1:F32'] = 300
  assert.equal(costTemplateChecks(state).find(item=>item.id==='carRental').ready,false)
})

test('报价拆分和财务 Excel 结果不一致时保持待核状态', () => {
  const state = base()
  Object.assign(state.templateEntries,{ '1:B8':600,'1:B9':400,'4:B5':'泰国','4:B6':'中国公司','4:B7':'DDP','4:B8':6,'4:B12':600,'4:B13':100,'4:B14':100,'4:B15':200,'4:B16':0.1 })
  state.extraCosts.tax = { status:'confirmed',amount:80,treatment:'cost' }
  let checks = costTemplateChecks(state,1000)
  assert.equal(checks.find(item=>item.id==='quote-split').ready,true)
  assert.equal(checks.find(item=>item.id==='tax-quote-split').ready,true)
  assert.equal(checks.find(item=>item.id==='tax-inputs').ready,false)
  state.templateTaxResultCny = 80
  state.templateTaxReviewEvidence = '财务核对导出表 B31'
  checks = costTemplateChecks(state,1000)
  assert.equal(checks.find(item=>item.id==='tax-inputs').ready,true)
  state.templateEntries['4:B15'] = 300
  assert.equal(costTemplateChecks(state,1000).find(item=>item.id==='tax-quote-split').ready,false)
})

test('模板中手填的额外成本会与工作台合计对照', () => {
  const state = base()
  state.templateEntries['1:F44'] = 50
  const issue = costTemplateChecks(state,null,0,{}).find(item=>item.id==='cost-total')
  assert.equal(issue.ready,false)
  assert.match(issue.detail,/50.00/)
})

test('拆分费用与公式费用只计一次，模板成本能与工作台对平', () => {
  const state = base()
  Object.assign(state.templateEntries,{ '1:F31':300,'1:F32':200,'1:F36':100,'1:F40':100,'1:F41':100,'2:F6':2,'2:R6':10,'2:T6':100,'4:B7':'DDP','4:B12':1000,'4:B16':0.1 })
  for (const [id,amount] of [['carRental',500],['siteManagement',300],['commissioningLabor',70000],['afterSales',1000],['duty',100]]) state.extraCosts[id] = { status:'confirmed',amount }
  const checks = costTemplateChecks(state,null,71900,{})
  assert.equal(checks.find(item=>item.id==='cost-total').ready,true)
  assert.equal(checks.filter(item=>!item.ready).length,0)
})
