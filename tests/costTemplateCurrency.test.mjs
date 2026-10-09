import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function moduleUrl(file, imports = {}) {
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll(`'${name}'`, JSON.stringify(url))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const configUrl = moduleUrl('src/lib/configVersions.ts')
const workflowUrl = moduleUrl('src/lib/commercialWorkflow.ts', { './configVersions': configUrl })
const { costTemplateInCurrency, costTemplateCurrencyIssues } = await import(moduleUrl('src/lib/costTemplateCurrency.ts', { './commercialWorkflow': workflowUrl }))
const { fillCostTemplate, readStoredZip } = await import(moduleUrl('src/lib/costTemplateExport.ts'))
const template = new Uint8Array(readFileSync('public/overseas-cost-template.xlsx'))
const sheetXml = (bytes, number) => new TextDecoder().decode(readStoredZip(bytes).find(entry=>entry.name===`xl/worksheets/sheet${number}.xml`).bytes)

test('外币版只换算金额，保留数量、月份、税率并修正模板人工费公式', () => {
  const inputs = {
    '1:B8':1000,'1:F14':800,'2:F6':2,'2:T6':100,'2:R6':6,'2:T19':75,
    '3:B4':0.3,'3:F6':500,'3:C11':200,'4:B8':6,'4:B12':1000,'4:B16':0.1,
    '7:C8':100,'7:C27':20,'7:D27':3,'7:E27':'CNY','7:C28':0.03,'7:D28':100,
  }
  const foreign = costTemplateInCurrency(inputs,'USD',0.14)
  assert.equal(foreign['1:B8'],140)
  assert.equal(foreign['2:F6'],2)
  assert.equal(foreign['2:T6'],14)
  assert.equal(foreign['2:R6'],6)
  assert.equal(foreign['3:B4'],0.3)
  assert.equal(foreign['3:F6'],70)
  assert.equal(foreign['4:B8'],6)
  assert.equal(foreign['4:B16'],0.1)
  assert.equal(foreign['7:C27'],2.8)
  assert.equal(foreign['7:C28'],0.0042)
  assert.equal(foreign['7:D27'],3)
  assert.equal(foreign['7:E27'],'USD')
  const result = fillCostTemplate(template, foreign, { laborRateFromCny: 0.14 })
  assert.match(sheetXml(result,1), /<x:c r="F7"[^>]*>.*?USD.*?<\/x:c>/)
  assert.match(sheetXml(result,1), /'1\.1 调试工时预估'!F14\*4900/)
  assert.match(sheetXml(result,7), /<x:c r="C27"[^>]*><x:v>2\.8<\/x:v><\/x:c>/)
})

test('人民币版不改变原值，清关物料未折人民币时阻止外币整表换算', () => {
  const inputs = { '1:F14':800,'2:F6':2,'7:C27':20,'7:E27':'USD' }
  assert.equal(costTemplateInCurrency(inputs,'CNY',null)['1:F14'],800)
  assert.deepEqual(costTemplateCurrencyIssues(inputs,'USD'),['清关物料第 1 行（E27）须先折成人民币，再生成USD成本版'])
  assert.throws(()=>costTemplateInCurrency(inputs,'USD',0.14),/先折成人民币/)
  assert.throws(()=>costTemplateInCurrency({'1:F14':800},'USD',null),/汇率/)
})
