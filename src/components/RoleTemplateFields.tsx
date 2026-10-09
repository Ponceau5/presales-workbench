import { useMemo } from 'react'
import { costTemplatePrefill } from '@/lib/costTemplatePrefill'
import { templateField, templateFieldLabel, templateSections, templateSheets } from '@/lib/costTemplateFields'
import type { CommercialState, CostRoute } from '@/lib/commercialWorkflow'
import type { Role } from '@/lib/workspace'

const options: Record<string, string[]> = {
  country: ['泰国','马来西亚','印度尼西亚','韩国','日本'], entity: ['中国公司','新加坡公司'],
  trade: ['FOB','CIF','DAP','DDU','DDP'], api: ['有','无'], clearance: ['正常清关','部分灰清','全部灰清'],
  clearanceOwner: ['货代公司','客户'], yesno: ['是','否'],
  currency: ['CNY','USD','EUR','HKD','THB','SGD','MYR','IDR','JPY','KRW','VND','BRL','AUD','GBP'],
}

export default function RoleTemplateFields({ route, state, role, canEdit, onUpdate }: {
  route: CostRoute
  state: CommercialState
  role: Role
  canEdit: boolean
  onUpdate: (patch: Partial<CommercialState>) => void
}) {
  const auto = useMemo(() => costTemplatePrefill(state), [state])
  const values = state.templateEntries || {}
  const sections = templateSections[route]

  function setValue(key: string, value: string | number) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return
    onUpdate({ templateEntries: { ...values, [key]: value } })
  }

  function fieldControl(sheet: number, ref: string) {
    const { row, field } = templateField(sheet, ref)
    if (!row || !field?.input) return null
    const key = `${sheet + 1}:${ref}`
    const managed = auto.cells[key]
    const label = templateFieldLabel(sheet, ref)
    const current = managed?.total ? managed.value ?? '' : values[key] ?? field.value ?? ''
    const disabled = !canEdit || !!field.financeOnly && role !== '财务 / 风控' || !!managed?.total
    const note = row.cells.find(cell => cell.column > field.column && typeof cell.value === 'string' && !cell.input)?.value
    let control
    if (managed?.total) control = <div className="cw-role-template-auto">{managed.value === null ? managed.notApplicable ? '已标不适用' : '等待上方岗位确认' : `自动带入 CNY ${managed.value.toLocaleString('zh-CN')}`}{managed.pending.length>0&&<small>仍有 {managed.pending.length} 笔待确认</small>}{managed.conflict&&<small>存在重复来源，请销售核对</small>}</div>
    else if (field.input === 'country') control = <input disabled={disabled} list="cw-role-countries" value={String(current)} onChange={event=>setValue(key,event.target.value)} placeholder="选择或输入国家"/>
    else if (options[field.input]) control = <select disabled={disabled} value={String(current)} onChange={event=>setValue(key,event.target.value)}><option value="">请选择</option>{!options[field.input].includes(String(current))&&current!==''&&<option value={String(current)}>{current}</option>}{options[field.input].map(item=><option key={item} value={item}>{item}</option>)}</select>
    else if (field.input === 'number' || field.input === 'percent') control = <div className="cw-role-template-number"><input disabled={disabled} type="number" min="0" step="any" value={current === '' ? '' : field.input === 'percent' ? Number(current) * 100 : Number(current)} onChange={event=>setValue(key,event.target.value === '' ? '' : field.input === 'percent' ? Number(event.target.value)/100 : Number(event.target.value))}/>{field.input === 'percent'&&<span>%</span>}</div>
    else control = <input disabled={disabled} list={field.input === 'country' ? 'cw-role-countries' : undefined} value={String(current)} onChange={event=>setValue(key,event.target.value)} placeholder={field.input === 'date' ? 'YYYY-MM-DD' : '按项目实际填写'}/>
    return <label key={key} className="cw-role-template-field"><span>{label}</span>{control}{typeof note === 'string' && note.trim() && sheet !== 1 && sheet !== 2 && (note.length < 170 ? <small>{note}</small> : <details><summary>原表填写说明</summary><small>{note}</small></details>)}{field.comment&&<details><summary>原表批注</summary><small>{field.comment}</small></details>}</label>
  }

  return <section className="cw-role-template"><div className="cw-role-template-head"><div><span className="cw-eyebrow">对应原表 · 岗位明细</span><h4>按模板字段填写，一次录入直接进入导出表</h4></div><span>{canEdit?'可填写':'当前岗位只读'}</span></div>
    {role === '销售' && route !== 'sales' && <p className="cw-note">销售代填的明细仍需对应岗位核对；金额只有在上方成本卡片确认后才计入成本版。</p>}
    {sections.map(section=>{
      const valid = section.refs.filter(ref=>templateField(section.sheet,ref).field?.input)
      const filled = valid.filter(ref=>{
        const key=`${section.sheet + 1}:${ref}`
        const item=auto.cells[key]
        const value=item?.total ? item.value : values[key]
        return value !== null && value !== undefined && value !== ''
      }).length
      return <details key={section.id} className="cw-role-template-section">
        <summary><strong>{section.title}</strong><span>{templateSheets[section.sheet].name} · {filled}/{valid.length} 个可填格有值{section.optional?' · 按需填写':''}</span></summary>
        <p>{section.note}</p><div className="cw-role-template-grid">{valid.map(ref=>fieldControl(section.sheet,ref))}</div>
      </details>
    })}
    {route === 'finance' && <div className="cw-role-template-review"><strong>财务核对 Excel 税费测算结果</strong><p>模板税费公式需在 Excel 中重算。财务填写重算结果，与上方已确认税费总额逐项核对；项目条件或税费金额变化后要重新复核。</p><div className="cw-role-template-grid"><label className="cw-role-template-field"><span>Excel 税费成本合计 · CNY</span><input type="number" min="0" step="any" disabled={role!=='财务 / 风控'} value={state.templateTaxResultCny ?? ''} onChange={event=>onUpdate({templateTaxResultCny:event.target.value===''?null:Number(event.target.value)})}/></label><label className="cw-role-template-field"><span>核对依据 / 文件版本与日期</span><input disabled={role!=='财务 / 风控'} value={state.templateTaxReviewEvidence || ''} onChange={event=>onUpdate({templateTaxReviewEvidence:event.target.value})} placeholder="如：导出表税费页 B31，财务核对日期"/></label></div></div>}
    <datalist id="cw-role-countries">{options.country.map(item=><option key={item} value={item}/>)}</datalist>
  </section>
}
