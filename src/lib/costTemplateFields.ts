import templateSchema from './costTemplateSchema.json'
import type { CostRoute } from './commercialWorkflow'

export type TemplateField = { ref: string; column: number; value: string | number | null; input?: string; comment?: string; financeOnly?: boolean }
export type TemplateRow = { number: number; cells: TemplateField[] }
export type TemplateSheet = { name: string; title: string; guide: string; rows: TemplateRow[] }
export const templateSheets = templateSchema.sheets as TemplateSheet[]

export type TemplateFieldSection = { id: string; title: string; sheet: number; refs: string[]; note: string; optional?: boolean }
const cols = (letters: string[], first: number, last: number) => Array.from({ length: last - first + 1 }, (_, offset) => letters.map(letter => `${letter}${first + offset}`)).flat()

export const templateSections: Record<CostRoute, TemplateFieldSection[]> = {
  sales: [
    { id: 'sales-project', title: '合同与项目基础信息', sheet: 0, refs: cols(['B'],2,10).concat('B12'), note: '填写签约双方、地址、付款方式及设备/服务分项报价。合同总报价按人民币填；对外币种在报价区另选。' },
    { id: 'sales-cash', title: '付款节点与预计回款', sheet: 2, refs: ['B2','F3',...cols(['B'],4,6),...cols(['F'],4,6),...cols(['B'],11,25),'P26','P27'], note: '合同约定的比例和预计到账月份分别填写；回款时间需结合项目进度判断。' },
    { id: 'sales-tax', title: '提交财务的商业条件与分项报价', sheet: 3, refs: ['B5','B6','B7','B12','B13','B14','B15'], note: '国家、签约主体、贸易术语和硬件/软件/调试/施工报价供财务测税；金额为人民币。' },
    { id: 'sales-extras', title: '销售负责的成本栏目', sheet: 0, refs: ['F37','F43','F47','F48'], note: '厂验、出口包装、资金和汇率风险金额从上方成本卡片自动归集。' },
  ],
  internal: [
    { id: 'internal-main', title: '自产成本在模板中的归集', sheet: 0, refs: ['F14','F18'], note: '已确认的自产行成本和组屏费自动汇总。请核对 CRM 料号、价格版本与折算依据；未归类的行交销售确认。' },
  ],
  purchase: [
    { id: 'purchase-main', title: '外购成本在模板中的归集', sheet: 0, refs: cols(['F'],20,26), note: '确认后的供应商成本按服务器、交换机、控制柜等归集；“其他设备”需复核品类，避免错误归入。' },
    { id: 'purchase-cash', title: '采购付款与本地采购条件', sheet: 2, refs: ['F28','G28','H28','B29'], note: '记录供应商付款方式和本地采购情况，供财务做现金流测算。' },
    { id: 'purchase-materials', title: '供关务核对的物料价值清单', sheet: 6, refs: cols(['B','C','D','E','G'],27,66), note: '逐项补物料描述/料号、合同单价、数量、币种；是否灰清由关务核对。备用行无需填满。', optional: true },
  ],
  software: [
    { id: 'software-main', title: '软件成本在模板中的归集', sheet: 0, refs: ['F27'], note: '确认的授权、编程等软件成本自动汇总。原表提醒区分通用与定制软件，需在成本依据中写清。' },
  ],
  project: [
    { id: 'project-main', title: '现场费用按模板栏目拆分', sheet: 0, refs: ['F16','F17','F29','F30','F31','F32','F33','F35','F36','F40','F41','F42','F44'], note: '租车与日常交通、现场管理与劳保仓储要分别填写，不能只填一笔合计。' },
    { id: 'project-hours', title: '调试工时与售后维保明细', sheet: 1, refs: cols(['B','C','D','E','F','H','L','N','O','P','Q','R','S','T','V'],6,13).concat('K19','L19','M19','N19','O19','P19','T19','V19'), note: '按岗位、人数、月份、工作方式，以及维保期限、工时和费率填写。主表调试/售后费用由本页公式生成。', optional: true },
    { id: 'project-cash', title: '项目采购支出计划', sheet: 2, refs: cols(['C','D','E','F','G','H','I','J','K'],8,8).concat(cols(['C','D','E','F','G','H','I','J','K'],11,25)), note: '按 T 月份列出服务器、交换机、施工、运费等采购支出；不发生的月份可留空。', optional: true },
    { id: 'project-duration', title: '预计项目工期', sheet: 3, refs: ['B8'], note: '工期用于财务判断目的国常设机构风险。' },
  ],
  customs: [
    { id: 'customs-tax', title: '财务测税所需的进口条件', sheet: 3, refs: ['B9','B16'], note: '确认印尼 API 资质和按 HS code 核定的关税率；税率须有依据。' },
    { id: 'customs-base', title: '清关方式、物流与主体', sheet: 6, refs: cols(['C'],4,10).concat('C16','C17','C18','C21'), note: '确认清关模式、贸易术语、运输方式、目的地、费用、清关资质及主体。' },
    { id: 'customs-main', title: '主表清关与国际物流', sheet: 0, refs: ['F38','F39'], note: '岗位确认的清关费与运费自动回填主表，并同步到清关测算页。' },
    { id: 'customs-materials', title: '逐项核对清关物料清单', sheet: 6, refs: cols(['B','C','D','E','G'],27,66), note: '与供应链共享这张明细表；逐项核对物料、单价、数量、币种和是否灰清。备用行无需填满。', optional: true },
  ],
  finance: [
    { id: 'finance-tax', title: '税费测算输入与复核', sheet: 3, refs: ['B5','B6','B7','B8','B9','B12','B13','B14','B15','B16','B26'], note: '复核销售、关务和项目经理输入的条件；软件税费及适用税率由财务确认。' },
    { id: 'finance-parameters', title: '历史税率与 PE 门槛参数', sheet: 4, refs: cols(['A','B','C','D','E','F','G','H','I','J','K','L','M'],4,15), note: '原表标为“无需填写”。仅当财务已核实当前规则时修改；旧参数不能直接当成现行税率。', optional: true },
    { id: 'finance-insurance', title: '出口信用保险', sheet: 0, refs: ['F49'], note: '经财务确认的保险费用从成本卡片自动带入。' },
    { id: 'finance-cash', title: '现金流测算输入核对', sheet: 2, refs: ['B2','F3',...cols(['B'],4,6),...cols(['F'],4,6),...cols(['B','C','D','E','F','G','H','I','J','K'],11,25)], note: '根据销售回款预测和项目支出计划复核；现金流由模板公式测算。', optional: true },
  ],
}

export function templateField(sheetIndex: number, ref: string) {
  const rowNumber = Number(ref.match(/\d+$/)?.[0])
  const row = templateSheets[sheetIndex].rows.find(item => item.number === rowNumber)
  return { row, field: row?.cells.find(cell => cell.ref === ref) }
}

export function templateFieldLabel(sheetIndex: number, ref: string) {
  const { row, field } = templateField(sheetIndex, ref)
  if (!row || !field) return ref
  if (sheetIndex === 0) {
    const label = row.cells.find(cell => cell.ref === `${field.column === 6 ? 'C' : 'A'}${row.number}`)?.value
    return `${typeof label === 'string' ? label.trim() : '项目名称'} · ${ref}`
  }
  if (sheetIndex === 1) {
    const heading = templateSheets[1].rows.find(item => item.number === (row.number === 19 ? 18 : 3))?.cells.find(cell => cell.column === field.column)?.value
    return `${row.number === 19 ? '维保估算' : `第 ${row.number - 5} 条`} · ${heading || ref}`
  }
  if (sheetIndex === 2 && row.number >= 11 && row.number <= 25) {
    const time = row.cells.find(cell=>cell.ref===`A${row.number}`)?.value
    const heading = field.column === 2 ? '预计收入' : templateSheets[2].rows.find(item=>item.number===8)?.cells.find(cell=>cell.column===field.column)?.value
    return `${time || row.number} · ${heading || ref}`
  }
  if (sheetIndex === 2 && row.number === 8) return `支出科目名称 · ${ref}`
  if (sheetIndex === 2 && row.number === 28) return `采购付款方式备注 · ${ref}`
  if (sheetIndex === 6 && row.number >= 27 && row.number <= 66) {
    const heading = templateSheets[6].rows.find(item=>item.number===26)?.cells.find(cell=>cell.column===field.column)?.value
    return `物料第 ${row.number - 26} 行 · ${heading || ref}`
  }
  if (sheetIndex === 4) {
    const heading = templateSheets[4].rows.find(item=>item.number===3)?.cells.find(cell=>cell.column===field.column)?.value
    return `历史参数第 ${row.number - 3} 行 · ${heading || ref}`
  }
  const label = row.cells.find(cell=>cell.column<field.column && typeof cell.value === 'string' && !cell.input)?.value
  return `${typeof label === 'string' ? label.trim() : templateSheets[sheetIndex].title} · ${ref}`
}

export function templateFieldRoutes(sheetIndex: number, ref: string): CostRoute[] {
  return (Object.entries(templateSections) as [CostRoute, TemplateFieldSection[]][])
    .filter(([,sections])=>sections.some(section=>section.sheet===sheetIndex&&section.refs.includes(ref)))
    .map(([route])=>route)
}
