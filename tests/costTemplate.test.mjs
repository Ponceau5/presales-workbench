import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/lib/costTemplateExport.ts','utf8')
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const { fillCostTemplate, readStoredZip } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('原版模板的七个页签和公式可保留，填入数据后压缩包仍可读', () => {
  const original = new Uint8Array(readFileSync('public/overseas-cost-template.xlsx'))
  const before = readStoredZip(original)
  assert.equal(before.filter(entry=>/^xl\/worksheets\/sheet\d\.xml$/.test(entry.name)).length,7)
  assert.doesNotMatch(new TextDecoder().decode(before.find(entry=>entry.name==='xl/worksheets/sheet1.xml').bytes), /XX项目-评估模版/)
  const result = fillCostTemplate(original, {
    '1:A1':'RCJM1项目-评估模板', '1:B2':'我司主体', '1:F14':1250, '3:B4':0.3, '4:B5':'马来西亚',
    '5:B5':0.11, '7:B27':'交换机', '7:C27':100, '7:D27':2,
  })
  const after = readStoredZip(result)
  assert.equal(after.length,before.length)
  const xml = name=>new TextDecoder().decode(after.find(entry=>entry.name===name).bytes)
  assert.match(xml('xl/worksheets/sheet1.xml'),/<x:c r="A1"[^>]*t="inlineStr"><x:is><x:t[^>]*>RCJM1项目-评估模板<\/x:t><\/x:is><\/x:c>/)
  assert.match(xml('xl/worksheets/sheet1.xml'),/<x:c r="B2"[^>]*t="inlineStr"><x:is><x:t[^>]*>我司主体<\/x:t><\/x:is><\/x:c>/)
  assert.match(xml('xl/worksheets/sheet1.xml'),/<x:c r="F14"[^>]*><x:v>1250<\/x:v><\/x:c>/)
  assert.match(xml('xl/worksheets/sheet3.xml'),/<x:c r="B4"[^>]*><x:v>0.3<\/x:v><\/x:c>/)
  assert.match(xml('xl/worksheets/sheet7.xml'),/<x:c r="F27"[^>]*><x:f[^>]*>[^<]*C27\*D27[^<]*<\/x:f>/)
  assert.match(xml('xl/workbook.xml'),/fullCalcOnLoad="1"/)
})

test('清空财务参数可以覆盖模板旧值，文本按普通单元格写入', () => {
  const original = new Uint8Array(readFileSync('public/overseas-cost-template.xlsx'))
  const result = fillCostTemplate(original, {'5:A4':'', '1:B3':'=2+2'})
  const after = readStoredZip(result)
  const sheet5 = new TextDecoder().decode(after.find(entry=>entry.name==='xl/worksheets/sheet5.xml').bytes)
  const sheet1 = new TextDecoder().decode(after.find(entry=>entry.name==='xl/worksheets/sheet1.xml').bytes)
  assert.match(sheet5,/<x:c r="A4"[^>]*\/>/)
  assert.match(sheet1,/<x:c r="B3"[^>]*t="inlineStr"><x:is><x:t[^>]*>=2\+2<\/x:t><\/x:is><\/x:c>/)
})

test('税费商务条件单列时可在导出主表记零，税费测算页公式仍保留', () => {
  const original = new Uint8Array(readFileSync('public/overseas-cost-template.xlsx'))
  const result = fillCostTemplate(original, {'1:F45':0})
  const after = readStoredZip(result)
  const main = new TextDecoder().decode(after.find(entry=>entry.name==='xl/worksheets/sheet1.xml').bytes)
  const tax = new TextDecoder().decode(after.find(entry=>entry.name==='xl/worksheets/sheet4.xml').bytes)
  assert.match(main,/<x:c r="F45"[^>]*><x:v>0<\/x:v><\/x:c>/)
  assert.match(tax,/<x:c r="B31"[^>]*><x:f/)
})
