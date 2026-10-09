import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const schema = JSON.parse(readFileSync('src/lib/costTemplateSchema.json','utf8'))
const source = readFileSync('src/lib/costTemplateFields.ts','utf8').replace("import templateSchema from './costTemplateSchema.json'",`const templateSchema = ${JSON.stringify(schema)}`)
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const { templateSections, templateSheets } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('原表每个可填单元格都有前置岗位入口，备用行和财务参数同样可访问', () => {
  const input = new Set(templateSheets.flatMap((sheet,index)=>sheet.rows.flatMap(row=>row.cells.filter(cell=>cell.input).map(cell=>`${index+1}:${cell.ref}`))))
  const assigned = new Set(Object.values(templateSections).flatMap(sections=>sections.flatMap(section=>section.refs.map(ref=>`${section.sheet+1}:${ref}`))))
  const missing = [...input].filter(key=>!assigned.has(key) && key!=='1:A1')
  assert.deepEqual(missing,[])
  assert.equal(templateSheets.length,7)
})
