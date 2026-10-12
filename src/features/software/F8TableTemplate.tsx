import { Download } from "lucide-react";
import { F7ReviewSummary } from "./F7TableTemplate";

export type F8TemplateKind = "mapping" | "quote";

const mappingHeaders = ["客户 BOQ 行号", "客户项目描述", "客户数量", "内部配置项", "内部数量", "拆分 / 合并规则", "数量差异", "依据与版本", "确认状态"];
const quoteHeaders = ["客户 BOQ 行号", "客户项目描述", "数量", "单位", "内部对应项", "成本依据", "报价单价", "报价合价", "币种", "审核状态"];
const placeholderRows = 5;

function dateVersion(generatedAt?: string) {
  const date = generatedAt ? new Date(generatedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return { version: "映射模板 V1", date: "尚未生成" };
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    version: `V${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`,
    date: date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  };
}

export function F8ReviewSummary({ kind, draft, generatedAt }: { kind: F8TemplateKind; draft?: string; generatedAt?: string }) {
  if (kind === "quote") return <F7ReviewSummary kind="quote" draft={draft} generatedAt={generatedAt}/>;
  const rows = draft?.split(/\r?\n/).filter(line => /^\|.*\|$/.test(line) && !/^\|[\s:|\-]+\|$/.test(line)) ?? [];
  const blank = draft ? rows.length ? rows.filter(line => /待补|待确认|未确认|空白/.test(line)).length : null : placeholderRows;
  const stamp = dateVersion(generatedAt);
  return <div className="gsa-f7-review-summary" aria-label="BOQ 映射表审核摘要">
    <div><small>映射闭合</small><strong>待核对</strong></div>
    <div><small>空白项{draft ? " · 草稿待补" : " · 模板待填"}</small><strong>{blank === null ? "待统计" : `${blank} 条`}</strong></div>
    <div className="version"><small>生成日期 · 版本</small><strong>{stamp.version}</strong><span>{stamp.date}</span></div>
  </div>;
}

function downloadCsv(kind: F8TemplateKind, projectId: string) {
  const headers = kind === "mapping" ? mappingHeaders : quoteHeaders;
  const rows = Array.from({ length: placeholderRows }, () => kind === "mapping"
    ? ["待补", "待补", "待补", "待补", "待补", "待确认", "待核对", "待补", "待确认"]
    : ["待补", "待补", "待补", "待补", "待补", "待补", "待补", "待补", "待确认", "待审核"]);
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const content = `\uFEFF${[headers, ...rows].map(row => row.map(escape).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectId}-${kind === "mapping" ? "客户BOQ映射表" : "客户报价表"}-待补模板.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function F8TableTemplate({ kind, projectId, draft, generatedAt }: { kind: F8TemplateKind; projectId: string; draft?: string; generatedAt?: string }) {
  const mapping = kind === "mapping";
  const headers = mapping ? mappingHeaders : quoteHeaders;
  return <section className="gsa-f7-template" aria-label={mapping ? "客户 BOQ 映射表模板" : "客户报价表模板"}>
    <F8ReviewSummary kind={kind} draft={draft} generatedAt={generatedAt}/>
    <div className="gsa-f7-template-head">
      <div><strong>{mapping ? "客户 BOQ 映射表" : "客户报价表"}</strong><p>{mapping ? "逐行核对客户 BOQ、内部配置、数量差异和拆分规则。" : "按客户 BOQ 结构填写报价；价格和币种须有人工确认的依据。"}</p></div>
      <button className="btn secondary" onClick={() => downloadCsv(kind, projectId)}><Download size={14}/>下载 CSV 模板</button>
    </div>
    <p className="gsa-f7-template-note">当前是空白演示模板。没有客户 BOQ 原表、有效内部清单和批准价格时，不自动确认映射或生成对外报价。</p>
    <div className="gsa-f7-template-scroll" role="region" aria-label={mapping ? "BOQ 映射表格" : "客户报价表格"} tabIndex={0}>
      <table style={{ minWidth: headers.length * 145 }}><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{Array.from({ length: placeholderRows }, (_, index) => <tr key={index}>{headers.map((header, cellIndex) => <td key={header} className="pending">{mapping ? cellIndex === 5 || cellIndex === 8 ? "待确认" : cellIndex === 6 ? "待核对" : "待补" : cellIndex === 8 ? "待确认" : cellIndex === 9 ? "待审核" : "待补"}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}
