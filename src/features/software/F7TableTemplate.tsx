import {FloatingNotice} from "@/components/FloatingNotice";
import { useState } from "react";
import { Download } from "lucide-react";
import { costSheets, quoteHeaders, quoteCategories, f7ReviewSummary, downloadF7Template, type F7TemplateKind, type F7DemoScenario } from "./f7Template";
export type { F7TemplateKind, F7DemoScenario } from "./f7Template";









// The quote columns follow the former F7逐项报价导出格式. Values are deliberately empty
// until a person confirms cost, pricing rules, currency and the matching configuration.





export function F7ReviewSummary({ kind, draft, generatedAt, demoScenario }: { kind: F7TemplateKind; draft?: string; generatedAt?: string; demoScenario?: F7DemoScenario | null }) {
  const summary = f7ReviewSummary(kind, draft, generatedAt, demoScenario);
  return <div className="gsa-f7-review-summary" aria-label={`${kind === "cost" ? "成本表" : "报价表"}审核摘要`}>
    <div><small>{summary.label}</small><strong>{summary.total}</strong></div>
    <div><small>{demoScenario ? kind === "cost" ? "主表空白项 · 演示范围" : "报价明细空白项" : `空白项${summary.templateOnly ? " · 模板待填" : " · 草稿待补"}`}</small><strong>{summary.blank === null ? "待统计" : `${summary.blank} 条`}</strong></div>
    <div className="version"><small>生成日期 · 版本</small><strong>{summary.version}</strong><span>{summary.dateLabel}</span></div>
  </div>;
}





function columnName(index: number) {
  let name = "";
  for (let number = index; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}

export default function F7TableTemplate({ kind, projectId, draft, generatedAt, demoScenario,onCellEdit,onDownload }: {onCellEdit?:(key:string,value:string|number)=>void;onDownload?:()=>void; kind: F7TemplateKind; projectId: string; draft?: string; generatedAt?: string; demoScenario?: F7DemoScenario | null }) {
  const [active, setActive] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const sheet = costSheets[active];
  return <section className="gsa-f7-template" aria-label={kind === "cost" ? "海外成本估算模板预览" : "逐项报价表模板预览"}>
    <F7ReviewSummary kind={kind} draft={draft} generatedAt={generatedAt} demoScenario={demoScenario}/>
    <div className="gsa-f7-template-head">
      <div><strong>{kind === "cost" ? "海外成本估算模板 V6" : "报价单 · 成本模板 V6"}</strong></div>
      <button className="btn secondary" onClick={() => onDownload?onDownload():void downloadF7Template(kind, projectId, demoScenario, generatedAt).catch(error => setDownloadError(error instanceof Error ? error.message : "下载失败"))}><Download size={14}/>下载 Excel</button>
    </div>
    {downloadError && <FloatingNotice role="alert" className="gsa-error">{downloadError}</FloatingNotice>}

    {kind === "cost" ? <>
      <div className="gsa-f7-template-tabs" role="tablist" aria-label="成本模板页签">{costSheets.map((item, index) => <button key={item.name} role="tab" aria-selected={active === index} className={active === index ? "active" : ""} onClick={() => setActive(index)}>{item.name}</button>)}</div>
      <p className="gsa-f7-template-sheet-title">{sheet.title}</p>
      <div className="gsa-f7-template-scroll gsa-f7-cost-grid" role="region" aria-label={`${sheet.name}表格预览`} tabIndex={0}><table style={{ minWidth: Math.max(680, sheet.columns * 105) }}><thead><tr><th>行</th>{Array.from({ length: sheet.columns }, (_, index) => <th key={index}>{columnName(index + 1)}</th>)}</tr></thead><tbody>{sheet.rows.map(row => { const cells = new Map(row.cells.map(cell => [cell.column, cell])); return <tr key={row.number} className={active===0&&(row.number===13||row.number===54)?"gsa-f7-business-header":undefined}><th scope="row">{row.number}</th>{Array.from({ length: sheet.columns }, (_, index) => { const cell = cells.get(index + 1); const key = `${active + 1}:${columnName(index + 1)}${row.number}`; const demoValue = demoScenario?.templateInputs[key] ?? demoScenario?.calculatedCells[key]; const text = demoValue !== undefined ? typeof demoValue === "number" ? demoValue.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : demoValue : cell?.ref === "A1" && active === 0 ? `${projectId}项目-成本估算草稿` : cell?.value !== null && cell?.value !== undefined && cell?.value !== "" ? String(cell.value) : cell?.formula ? "Excel 公式" : cell?.input ? "待补" : ""; return <td key={index} className={demoValue === undefined && cell?.input && !cell.value ? "pending" : cell?.formula ? "formula" : ""} title={cell?.ref}>{onCellEdit&&cell?.input&&!cell.formula?<input aria-label={`${sheet.name} ${cell.ref}`} type={cell.input==="number"?"number":"text"} step="any" value={demoValue??cell.value??""} onChange={e=>onCellEdit(key,cell.input==="number"&&e.target.value!==""?Number(e.target.value):e.target.value)}/>:text}</td>; })}</tr>; })}</tbody></table></div>
    </> : <div className="gsa-f7-template-scroll" role="region" aria-label="报价表格预览" tabIndex={0}><table style={{ minWidth: quoteHeaders.length * 118 }}><thead><tr>{quoteHeaders.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{demoScenario ? <>{demoScenario.quoteRows.map(row => { const cost = row.qty * row.costUnit, price = row.qty * row.quoteUnit; return <tr key={row.sku}><td>{demoScenario.project}</td><td>DEMO-V1</td><td>{row.sku}</td><td>{row.kind}</td><td>{row.name}</td><td>{row.qty}</td><td>{row.costUnit.toLocaleString("zh-CN")}</td><td>{cost.toLocaleString("zh-CN")}</td><td>{row.quoteUnit ? (row.quoteUnit / row.costUnit).toFixed(2) : "—"}</td><td>{row.quoteUnit.toLocaleString("zh-CN")}</td><td>{price.toLocaleString("zh-CN")}</td><td>{row.quoteUnit.toLocaleString("zh-CN")}</td><td>{price.toLocaleString("zh-CN")}</td><td>—</td><td>模拟待审核</td><td>{row.basis}</td></tr>; })}<tr className="gsa-f7-business-header"><td>{demoScenario.project}</td><td>DEMO-V1</td><td/><td>合计</td><td/><td/><td/><td/><td/><td/><td/><td/><td>{demoScenario.totals.quote.toLocaleString("zh-CN")}</td><td/><td>模拟待审核</td><td>全表为虚构演示数据</td></tr></> : quoteCategories.map(category => <tr key={category}><td>{projectId}</td><td/><td/><td>{category}</td>{Array.from({ length: 10 }, (_, index) => <td key={index} className="pending">待补</td>)}<td>待补成本与定价依据</td><td/></tr>)}</tbody></table></div>}
  </section>;
}
