import { useState } from "react";
import { Download } from "lucide-react";
import costSchema from "@/lib/f7CostTemplateSchema.json";
import { fillCostTemplate } from "@/lib/f7CostTemplateExport";

export type F7TemplateKind = "cost" | "quote";

type TemplateCell = { ref: string; column: number; value: string | number | null; formula?: boolean; input?: string };
type TemplateSheet = { name: string; title: string; guide?: string; columns: number; rows: { number: number; cells: TemplateCell[] }[] };
const costSheets = costSchema.sheets as TemplateSheet[];

// The quote columns follow the former F7逐项报价导出格式. Values are deliberately empty
// until a person confirms cost, pricing rules, currency and the matching configuration.
const quoteHeaders = ["项目", "配置版本", "清单ID", "成本类型", "名称", "数量", "单位成本CNY", "成本合计CNY", "报价系数", "建议单价CNY", "建议合价CNY", "报价单价CNY", "报价合价CNY", "报价合价外币", "状态", "定价依据"];
const quoteCategories = ["自产产品", "外购设备", "软件", "施工与服务", "补充费用"];
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadF7Template(kind: F7TemplateKind, projectId: string) {
  if (kind === "cost") {
    const response = await fetch(`${import.meta.env.BASE_URL}overseas-cost-template.xlsx`);
    if (!response.ok) throw new Error("海外成本模板未能加载");
    const filled = fillCostTemplate(new Uint8Array(await response.arrayBuffer()), { "1:A1": `${projectId}项目-成本估算草稿` });
    saveBlob(new Blob([Uint8Array.from(filled)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${projectId}-海外成本估算模板V6-待补草稿.xlsx`);
    return;
  }
  const rows = [quoteHeaders, ...quoteCategories.map(category => [projectId, "", "", category, "", "", "", "", "", "", "", "", "", "", "待补成本与定价依据", ""]), [projectId, "", "", "合计", "", "", "", "", "", "", "", "", "", "", "待人工审核", ""]];
  const content = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
  saveBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), `${projectId}-逐项报价表-待补草稿.csv`);
}

function columnName(index: number) {
  let name = "";
  for (let number = index; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}

export default function F7TableTemplate({ kind, projectId }: { kind: F7TemplateKind; projectId: string }) {
  const [active, setActive] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const sheet = costSheets[active];
  return <section className="gsa-f7-template" aria-label={kind === "cost" ? "海外成本估算模板预览" : "逐项报价表模板预览"}>
    <div className="gsa-f7-template-head">
      <div><strong>{kind === "cost" ? "海外成本估算模板 V6" : "逐项报价表"}</strong><p>{kind === "cost" ? "参考模板共 7 个页签。保留原有公式、格式与填写说明；当前只带入项目编号。" : "沿用旧版逐项报价表的 16 列结构，供成本、定价与审核逐项填写。"}</p></div>
      <button className="btn secondary" onClick={() => void downloadF7Template(kind, projectId).catch(error => setDownloadError(error instanceof Error ? error.message : "下载失败"))}><Download size={14}/>下载{kind === "cost" ? " Excel" : " CSV"} 模板</button>
    </div>
    {downloadError && <p role="alert" className="gsa-error">{downloadError}</p>}
    <p className="gsa-f7-template-note">模板中的空白与“待补”不代表已核算或已批准金额；需要人工核对来源、币种和审批结果。</p>
    {kind === "cost" ? <>
      <div className="gsa-f7-template-tabs" role="tablist" aria-label="成本模板页签">{costSheets.map((item, index) => <button key={item.name} role="tab" aria-selected={active === index} className={active === index ? "active" : ""} onClick={() => setActive(index)}>{item.name}</button>)}</div>
      <p className="gsa-f7-template-sheet-title">{sheet.title}{sheet.guide ? ` · ${sheet.guide}` : ""}</p>
      <div className="gsa-f7-template-scroll" role="region" aria-label={`${sheet.name}表格预览`} tabIndex={0}><table style={{ minWidth: Math.max(680, sheet.columns * 105) }}><thead><tr><th>行</th>{Array.from({ length: sheet.columns }, (_, index) => <th key={index}>{columnName(index + 1)}</th>)}</tr></thead><tbody>{sheet.rows.map(row => { const cells = new Map(row.cells.map(cell => [cell.column, cell])); return <tr key={row.number}><th scope="row">{row.number}</th>{Array.from({ length: sheet.columns }, (_, index) => { const cell = cells.get(index + 1); const text = cell?.ref === "A1" && active === 0 ? `${projectId}项目-成本估算草稿` : cell?.value !== null && cell?.value !== undefined && cell?.value !== "" ? String(cell.value) : cell?.formula ? "Excel 公式" : cell?.input ? "待补" : ""; return <td key={index} className={cell?.input && !cell.value ? "pending" : cell?.formula ? "formula" : ""} title={cell?.ref}>{text}</td>; })}</tr>; })}</tbody></table></div>
    </> : <div className="gsa-f7-template-scroll" role="region" aria-label="报价表格预览" tabIndex={0}><table style={{ minWidth: quoteHeaders.length * 118 }}><thead><tr>{quoteHeaders.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{quoteCategories.map(category => <tr key={category}><td>{projectId}</td><td/><td/><td>{category}</td>{Array.from({ length: 10 }, (_, index) => <td key={index} className="pending">待补</td>)}<td>待补成本与定价依据</td><td/></tr>)}</tbody></table></div>}
  </section>;
}
