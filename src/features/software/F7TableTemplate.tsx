import { useState } from "react";
import { Download } from "lucide-react";
import costSchema from "@/lib/f7CostTemplateSchema.json";
import { fillCostTemplate } from "@/lib/f7CostTemplateExport";

export type F7TemplateKind = "cost" | "quote";
export type F7DemoScenario = {
  project: string;
  crm: { sku: string; name: string; qty: number; listUnit: number; costUnit: number; quoteUnit: number; kind: string; basis: string }[];
  quoteRows: { sku: string; name: string; kind: string; qty: number; costUnit: number; quoteUnit: number; basis: string }[];
  assumptions: string[];
  templateInputs: Record<string, string | number>;
  calculatedCells: Record<string, string | number>;
  totals: { materials: number; software: number; labor: number; operations: number; tax: number; financing: number; cost: number; hardwareQuote: number; serviceQuote: number; quote: number; grossMargin: number };
  overrides: { serverCostUnit?: number };
  recognizedChange: boolean;
};

type TemplateCell = { ref: string; column: number; value: string | number | null; formula?: boolean; input?: string };
type TemplateSheet = { name: string; title: string; guide?: string; columns: number; rows: { number: number; cells: TemplateCell[] }[] };
const costSheets = costSchema.sheets as TemplateSheet[];

// The quote columns follow the former F7逐项报价导出格式. Values are deliberately empty
// until a person confirms cost, pricing rules, currency and the matching configuration.
const quoteHeaders = ["项目", "配置版本", "清单ID", "成本类型", "名称", "数量", "单位成本CNY", "成本合计CNY", "报价系数", "建议单价CNY", "建议合价CNY", "报价单价CNY", "报价合价CNY", "报价合价外币", "状态", "定价依据"];
const quoteCategories = ["自产产品", "外购设备", "软件", "施工与服务", "补充费用"];
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function f7ReviewSummary(kind: F7TemplateKind, draft?: string, generatedAt?: string, demoScenario?: F7DemoScenario | null) {
  const label = kind === "cost" ? "总成本" : "总报价";
  const totalLine = draft?.split(/\r?\n/).find(line => line.includes(label) && !/待补|待确认|未确认|空白/.test(line));
  const amount = totalLine?.match(/(CNY|RMB|USD|RM|人民币|[¥￥])\s*([\d,]+(?:\.\d+)?)/i);
  const total = amount ? `${amount[1]} ${amount[2]}` : demoScenario ? `CNY ${(kind === "cost" ? demoScenario.totals.cost : demoScenario.totals.quote).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "待核算";
  const rows = draft?.split(/\r?\n/).filter(line => /^\|.*\|$/.test(line) && !/^\|[\s:|\-]+\|$/.test(line)) ?? [];
  const blank = draft ? rows.length ? rows.filter(line => /待补|待确认|未确认|空白/.test(line)).length : null : demoScenario ? 0 : kind === "cost"
    ? costSheets[0].rows.reduce((count, row) => count + row.cells.filter(cell => cell.input && (cell.value === null || cell.value === "")).length, 0)
    : quoteCategories.length;
  const date = generatedAt ? new Date(generatedAt) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const pad = (number: number) => String(number).padStart(2, "0");
  const version = validDate ? `V${validDate.getFullYear()}${pad(validDate.getMonth() + 1)}${pad(validDate.getDate())}-${pad(validDate.getHours())}${pad(validDate.getMinutes())}` : demoScenario ? "模拟数据 V1" : kind === "cost" ? "参考模板 V6" : "报价模板 V1";
  const dateLabel = validDate ? validDate.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "尚未生成";
  return { label, total, blank, version, dateLabel, templateOnly: !draft };
}

export function F7ReviewSummary({ kind, draft, generatedAt, demoScenario }: { kind: F7TemplateKind; draft?: string; generatedAt?: string; demoScenario?: F7DemoScenario | null }) {
  const summary = f7ReviewSummary(kind, draft, generatedAt, demoScenario);
  return <div className="gsa-f7-review-summary" aria-label={`${kind === "cost" ? "成本表" : "报价表"}审核摘要`}>
    <div><small>{summary.label}</small><strong>{summary.total}</strong></div>
    <div><small>{demoScenario ? kind === "cost" ? "主表空白项 · 演示范围" : "报价明细空白项" : `空白项${summary.templateOnly ? " · 模板待填" : " · 草稿待补"}`}</small><strong>{summary.blank === null ? "待统计" : `${summary.blank} 条`}</strong></div>
    <div className="version"><small>生成日期 · 版本</small><strong>{summary.version}</strong><span>{summary.dateLabel}</span></div>
  </div>;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadF7Template(kind: F7TemplateKind, projectId: string, demoScenario?: F7DemoScenario | null) {
  if (kind === "cost") {
    const response = await fetch(`${import.meta.env.BASE_URL}overseas-cost-template.xlsx`);
    if (!response.ok) throw new Error("海外成本模板未能加载");
    const filled = fillCostTemplate(new Uint8Array(await response.arrayBuffer()), demoScenario?.templateInputs ?? { "1:A1": `${projectId}项目-成本估算草稿` });
    saveBlob(new Blob([Uint8Array.from(filled)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${projectId}-海外成本估算模板V6-${demoScenario ? "模拟演示" : "待补草稿"}.xlsx`);
    return;
  }
  const rows = demoScenario ? [quoteHeaders, ...demoScenario.quoteRows.map(row => {
    const cost = row.qty * row.costUnit, price = row.qty * row.quoteUnit;
    return [demoScenario.project, "DEMO-V1", row.sku, row.kind, row.name, row.qty, row.costUnit, cost, row.quoteUnit ? Number((row.quoteUnit / row.costUnit).toFixed(4)) : "", row.quoteUnit, price, row.quoteUnit, price, "", "模拟待审核", row.basis].map(String);
  }), [demoScenario.project, "DEMO-V1", "", "合计", "", "", "", String(demoScenario.totals.cost), "", "", "", "", String(demoScenario.totals.quote), "", "模拟待审核", "全表为虚构演示数据"]] : [quoteHeaders, ...quoteCategories.map(category => [projectId, "", "", category, "", "", "", "", "", "", "", "", "", "", "待补成本与定价依据", ""]), [projectId, "", "", "合计", "", "", "", "", "", "", "", "", "", "", "待人工审核", ""]];
  const content = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
  saveBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), `${projectId}-逐项报价表-${demoScenario ? "模拟演示" : "待补草稿"}.csv`);
}

function columnName(index: number) {
  let name = "";
  for (let number = index; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}

export default function F7TableTemplate({ kind, projectId, draft, generatedAt, demoScenario }: { kind: F7TemplateKind; projectId: string; draft?: string; generatedAt?: string; demoScenario?: F7DemoScenario | null }) {
  const [active, setActive] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const sheet = costSheets[active];
  return <section className="gsa-f7-template" aria-label={kind === "cost" ? "海外成本估算模板预览" : "逐项报价表模板预览"}>
    <F7ReviewSummary kind={kind} draft={draft} generatedAt={generatedAt} demoScenario={demoScenario}/>
    <div className="gsa-f7-template-head">
      <div><strong>{kind === "cost" ? "海外成本估算模板 V6" : "逐项报价表"}</strong><p>{demoScenario ? `已填入 ${demoScenario.project} 的虚构 CRM 和演示计算；${kind === "cost" ? "主表关键输入已填，辅助页仍有非演示项。Excel 保留原有公式，打开时重新计算。" : "间接成本列入明细并由合同总价覆盖。"}` : kind === "cost" ? "参考模板共 7 个页签。保留原有公式、格式与填写说明；当前只带入项目编号。" : "沿用旧版逐项报价表的 16 列结构，供成本、定价与审核逐项填写。"}</p></div>
      <button className="btn secondary" onClick={() => void downloadF7Template(kind, projectId, demoScenario).catch(error => setDownloadError(error instanceof Error ? error.message : "下载失败"))}><Download size={14}/>下载{kind === "cost" ? " Excel" : " CSV"} {demoScenario ? "演示表" : "模板"}</button>
    </div>
    {downloadError && <p role="alert" className="gsa-error">{downloadError}</p>}
    <p className="gsa-f7-template-note">{demoScenario ? "模拟数据仅用于流程演示；CRM 价格、采购回价、税费和报价均非当前项目事实，不能直接对外使用。" : "模板中的空白与“待补”不代表已核算或已批准金额；需要人工核对来源、币种和审批结果。"}</p>
    {kind === "cost" ? <>
      <div className="gsa-f7-template-tabs" role="tablist" aria-label="成本模板页签">{costSheets.map((item, index) => <button key={item.name} role="tab" aria-selected={active === index} className={active === index ? "active" : ""} onClick={() => setActive(index)}>{item.name}</button>)}</div>
      <p className="gsa-f7-template-sheet-title">{sheet.title}{sheet.guide ? ` · ${sheet.guide}` : ""}</p>
      <div className="gsa-f7-template-scroll gsa-f7-cost-grid" role="region" aria-label={`${sheet.name}表格预览`} tabIndex={0}><table style={{ minWidth: Math.max(680, sheet.columns * 105) }}><thead><tr><th>行</th>{Array.from({ length: sheet.columns }, (_, index) => <th key={index}>{columnName(index + 1)}</th>)}</tr></thead><tbody>{sheet.rows.map(row => { const cells = new Map(row.cells.map(cell => [cell.column, cell])); return <tr key={row.number} className={active===0&&(row.number===13||row.number===54)?"gsa-f7-business-header":undefined}><th scope="row">{row.number}</th>{Array.from({ length: sheet.columns }, (_, index) => { const cell = cells.get(index + 1); const key = `${active + 1}:${columnName(index + 1)}${row.number}`; const demoValue = demoScenario?.templateInputs[key] ?? demoScenario?.calculatedCells[key]; const text = demoValue !== undefined ? typeof demoValue === "number" ? demoValue.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : demoValue : cell?.ref === "A1" && active === 0 ? `${projectId}项目-成本估算草稿` : cell?.value !== null && cell?.value !== undefined && cell?.value !== "" ? String(cell.value) : cell?.formula ? "Excel 公式" : cell?.input ? "待补" : ""; return <td key={index} className={demoValue === undefined && cell?.input && !cell.value ? "pending" : cell?.formula ? "formula" : ""} title={cell?.ref}>{text}</td>; })}</tr>; })}</tbody></table></div>
    </> : <div className="gsa-f7-template-scroll" role="region" aria-label="报价表格预览" tabIndex={0}><table style={{ minWidth: quoteHeaders.length * 118 }}><thead><tr>{quoteHeaders.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{demoScenario ? <>{demoScenario.quoteRows.map(row => { const cost = row.qty * row.costUnit, price = row.qty * row.quoteUnit; return <tr key={row.sku}><td>{demoScenario.project}</td><td>DEMO-V1</td><td>{row.sku}</td><td>{row.kind}</td><td>{row.name}</td><td>{row.qty}</td><td>{row.costUnit.toLocaleString("zh-CN")}</td><td>{cost.toLocaleString("zh-CN")}</td><td>{row.quoteUnit ? (row.quoteUnit / row.costUnit).toFixed(2) : "—"}</td><td>{row.quoteUnit.toLocaleString("zh-CN")}</td><td>{price.toLocaleString("zh-CN")}</td><td>{row.quoteUnit.toLocaleString("zh-CN")}</td><td>{price.toLocaleString("zh-CN")}</td><td>—</td><td>模拟待审核</td><td>{row.basis}</td></tr>; })}<tr className="gsa-f7-business-header"><td>{demoScenario.project}</td><td>DEMO-V1</td><td/><td>合计</td><td/><td/><td/><td/><td/><td/><td/><td/><td>{demoScenario.totals.quote.toLocaleString("zh-CN")}</td><td/><td>模拟待审核</td><td>全表为虚构演示数据</td></tr></> : quoteCategories.map(category => <tr key={category}><td>{projectId}</td><td/><td/><td>{category}</td>{Array.from({ length: 10 }, (_, index) => <td key={index} className="pending">待补</td>)}<td>待补成本与定价依据</td><td/></tr>)}</tbody></table></div>}
  </section>;
}
