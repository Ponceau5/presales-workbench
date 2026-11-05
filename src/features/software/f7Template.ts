import costSchema from "@/lib/f7CostTemplateSchema.json";
import { addQuoteSheetToCostTemplate, fillCostTemplate } from "@/lib/f7CostTemplateExport";
export type F7TemplateKind = "cost" | "quote";

export type F7DemoScenario = {
  demo_kind?:string;
  project: string;
  crm: { model?:string;source?:string;sku: string; name: string; qty: number; listUnit: number; costUnit: number; quoteUnit: number; kind: string; basis: string }[];
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

const quoteHeaders = ["项目", "配置版本", "清单ID", "成本类型", "名称", "数量", "单位成本CNY", "成本合计CNY", "报价系数", "建议单价CNY", "建议合价CNY", "报价单价CNY", "报价合价CNY", "报价合价外币", "状态", "定价依据"];

const quoteCategories = ["自产产品", "外购设备", "软件", "施工与服务", "补充费用"];

export function f7ReviewSummary(kind: F7TemplateKind, draft?: string, generatedAt?: string, demoScenario?: F7DemoScenario | null) {
  const label = kind === "cost" ? "总成本" : "总报价";
  const totalLine = draft?.split(/\r?\n/).find(line => line.includes(label) && !/待补|待确认|未确认|空白/.test(line));
  const amount = totalLine?.match(/(CNY|RMB|USD|RM|人民币|[¥￥])\s*([\d,]+(?:\.\d+)?)/i);
  const total = amount ? `${amount[1]} ${amount[2]}` : demoScenario ? `CNY ${(kind === "cost" ? demoScenario.totals.cost : demoScenario.totals.quote).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "待核算";
  const rows = draft?.split(/\r?\n/).filter(line => /^\|.*\|$/.test(line) && !/^\|[\s:|-]+\|$/.test(line)) ?? [];
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

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadF7Template(kind: F7TemplateKind, projectId: string, demoScenario?: F7DemoScenario | null, generatedAt?: string) {
  const response = await fetch(`${import.meta.env.BASE_URL}overseas-cost-template.xlsx`);
  if (!response.ok) throw new Error("海外成本模板未能加载");
  const filled = fillCostTemplate(new Uint8Array(await response.arrayBuffer()), demoScenario?.templateInputs ?? { "1:A1": `${projectId}项目-成本估算草稿` });
  if (kind === "cost") {
    saveBlob(new Blob([Uint8Array.from(filled)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${projectId}-海外成本估算模板V6-${demoScenario ? "模拟演示" : "待补草稿"}.xlsx`);
    return;
  }
  const rows = demoScenario ? demoScenario.quoteRows.map(row => {
    const cost = row.qty * row.costUnit, price = row.qty * row.quoteUnit;
    return [demoScenario.project, "DEMO-V1", row.sku, row.kind, row.name, row.qty, row.costUnit, cost, row.quoteUnit ? Number((row.quoteUnit / row.costUnit).toFixed(4)) : "", row.quoteUnit, price, row.quoteUnit, price, "", "模拟待审核", row.basis];
  }) : quoteCategories.map(category => [projectId, "", "", category, "", "", "", "", "", "", "", "", "", "", "待补成本与定价依据", ""]);
  const workbook = addQuoteSheetToCostTemplate(filled, { project: demoScenario?.project ?? projectId, headers: quoteHeaders, rows, demo: !!demoScenario, generatedAt });
  saveBlob(new Blob([Uint8Array.from(workbook)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${projectId}-报价单-海外成本估算模板V6-${demoScenario ? "模拟演示" : "待补草稿"}.xlsx`);
}
export { costSheets, quoteHeaders, quoteCategories };
