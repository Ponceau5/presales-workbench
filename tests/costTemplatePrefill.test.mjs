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
const { initialCommercialState, inventoryFor } = await import(workflowUrl)
const { costTemplatePrefill, templateCellForLine } = await import(moduleUrl('src/lib/costTemplatePrefill.ts', { './commercialWorkflow': workflowUrl }))
const { fillCostTemplate, readStoredZip } = await import(moduleUrl('src/lib/costTemplateExport.ts'))

const confirmed = amount => ({ amount, status: 'confirmed', evidence: '岗位已核报价', owner: '供应链', updatedAt: '' })

test('岗位确认后直接带入模板，撤销确认后自动值同步失效', () => {
  const state = initialCommercialState()
  const server = inventoryFor(state.baseline).find(line => line.kind === '外购设备' && /服务器/.test(line.name))
  assert.equal(templateCellForLine(server), '1:F20')
  state.costs[server.id] = confirmed(100)
  state.extraCosts.packaging = { amount: 35, status: 'confirmed', evidence: '包装询价', reason: '' }
  let result = costTemplatePrefill(state)
  assert.equal(result.cells['1:F20'].value, 100 * server.quantity)
  assert.equal(result.cells['1:F43'].value, 35)
  assert.ok(result.cells['1:F20'].pending.length > 0)
  state.costs[server.id].status = 'pending'
  state.extraCosts.packaging.status = 'pending'
  result = costTemplatePrefill(state)
  assert.equal(result.cells['1:F20'].value, null)
  assert.equal(result.cells['1:F43'].value, null)
})

test('有歧义的工时费用待归类，同一模板栏的双来源不自动相加', () => {
  const state = initialCommercialState()
  const lines = inventoryFor(state.baseline)
  const commissioning = lines.find(line => /系统调试/.test(line.name))
  const design = lines.find(line => /深化设计/.test(line.name))
  state.costs[commissioning.id] = confirmed(100)
  state.costs[design.id] = confirmed(200)
  state.extraCosts.design = { amount: 300, status: 'confirmed', evidence: '设计院报价', reason: '' }
  const result = costTemplatePrefill(state)
  assert.ok(result.unassigned.some(item => item.includes(commissioning.name)))
  assert.equal(result.cells['1:F33'].conflict, true)
  assert.equal(result.cells['1:F33'].value, null)
})

test('自动带入值直接写到导出的原格式成本表', () => {
  const state = initialCommercialState()
  state.extraCosts.packaging = { amount: 35, status: 'confirmed', evidence: '包装询价', reason: '' }
  const auto = costTemplatePrefill(state)
  const inputs = Object.fromEntries(Object.entries(auto.cells).filter(([,cell])=>cell.value !== null).map(([key,cell])=>[key,cell.value]))
  const result = fillCostTemplate(new Uint8Array(readFileSync('public/overseas-cost-template.xlsx')), inputs)
  const sheet = new TextDecoder().decode(readStoredZip(result).find(entry=>entry.name==='xl/worksheets/sheet1.xml').bytes)
  assert.match(sheet, /<x:c r="F43"[^>]*><x:v>35<\/x:v><\/x:c>/)
})

test('关务三笔已确认费用同步到清关测算页，销售已确认报价同步到主表', () => {
  const state = initialCommercialState()
  for (const [id,amount] of [['freight',100],['clearance',50],['duty',20]]) state.extraCosts[id] = {amount,status:'confirmed',evidence:'货代报价',reason:''}
  state.draftPriceCny = 1000
  state.quoteConfirmedAt = '2026-10-09'
  const cells = costTemplatePrefill(state).cells
  assert.equal(cells['7:C8'].value,100)
  assert.equal(cells['7:C9'].value,50)
  assert.equal(cells['7:C10'].value,20)
  assert.equal(cells['1:B7'].value,1000)
})

test('销售重新归类后已确认成本移动到指定模板栏目', () => {
  const state = initialCommercialState()
  const line = inventoryFor(state.baseline).find(item=>item.kind==='外购设备' && /服务器/.test(item.name))
  state.costs[line.id] = confirmed(100)
  state.templateCategoryOverrides[line.id] = '1:F26'
  const cells = costTemplatePrefill(state).cells
  assert.equal(cells['1:F26'].value,100*line.quantity)
  assert.equal(cells['1:F20']?.value ?? null,null)
})
