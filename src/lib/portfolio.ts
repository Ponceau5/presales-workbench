export interface ProjectResource {
  id: string;
  projectId: string;
  title: string;
  kind: "原始资料" | "工件" | "项目笔记";
  format: string;
  version: string;
  summary: string;
  path: string;
  source: string;
  folder?: string;
  size?: number;
  modified?: string;
}
export const rackProject = {
  id: "RCJM1",
  name: "Racks Central · RCJM1",
  owner: "项目团队",
  updated: "2026-09-15",
  reference: true,
  region: "马来西亚 · 柔佛",
  phase: "执行交付",
  scope: "BMS / DCIM / BA 冷站群控",
  milestone: "2026-11-06",
  notePath:
    "/Users/a48750/Desktop/胡珊珊/CET/CET-Vault/10-项目/进行中/Racks Central/Racks Central.md",
};
const root =
  "/Users/a48750/Desktop/数据中心海外资料/项目相关文档/2026年/Racks Central";
export const projectResources: ProjectResource[] = [
  {
    id: "RC-DCOM",
    projectId: "RCJM1",
    title: "DCOM 需求分析",
    kind: "工件",
    format: "DOCX",
    version: "2026-08-20 · V1.0",
    summary:
      "PTW、客户服务、访客与物品进出、培训等需求；保留原文未补齐项。文件名 v2，文内版本为 V1.0。",
    path: root + "/RC DCOM需求分析_v2.docx",
    source: "原始文档 · 版本修改记录",
  },
  {
    id: "RC-NOTE",
    projectId: "RCJM1",
    title: "Racks Central 项目档案",
    kind: "项目笔记",
    format: "MD",
    version: "2026-09-15",
    summary: "项目身份、交付范围、配置口径、活文件目录与跟进事项。",
    path: rackProject.notePath,
    source: "Obsidian · Racks Central",
  },
  {
    id: "RC-POINT",
    projectId: "RCJM1",
    title: "BMS Point Schedule",
    kind: "原始资料",
    format: "XLSX",
    version: "2026-04-13",
    summary:
      "招标版点表，含 PLC-Mech、PLC-Elect、DDC 与 DCIM-High Level 五个 sheet。",
    path:
      root +
      "/racks central图纸/OneDrive_1_2026-5-6/04.2 Specifications/BMS Point Schedule-20260413.xlsx",
    source: "项目页 · 点表活页链接",
  },
  {
    id: "RC-CONFIG",
    projectId: "RCJM1",
    title: "BMS 配置基线",
    kind: "工件",
    format: "XLS",
    version: "2026-09-06",
    summary: "中标后配置清单与内嵌 BMS 点表；设备对象数与测点数需区分。",
    path: root + "/20260906 Racks Central MY BMS Configuation.xls",
    source: "项目页 · 配置基线",
  },
  {
    id: "RC-BA",
    projectId: "RCJM1",
    title: "BA 点表与清单",
    kind: "工件",
    format: "XLS",
    version: "2026-08-12",
    summary: "中标后更新版，含 BA 点表、控制柜清单、界面与澄清。",
    path: root + "/RC项目BA点表+清单20260812(中标后更新版).xls",
    source: "项目页 · 点表活页链接",
  },
  {
    id: "RC-PTC",
    projectId: "RCJM1",
    title: "PTC No.2 澄清记录",
    kind: "工件",
    format: "XLSX",
    version: "No.2",
    summary: "客户与技术澄清记录；具体答复与闭环状态以原表为准。",
    path:
      root +
      "/racks central图纸/2026_07_29_01-WATER-LEAK-DETECTION(1)/PTC No.2 - BMS - CET(1).xlsx",
    source: "项目页 · 澄清",
  },
  {
    id: "RC-SOO",
    projectId: "RCJM1",
    title: "6370-SOO-01 控制序列",
    kind: "原始资料",
    format: "PDF",
    version: "项目页登记版",
    summary: "控制序列文件，项目页登记为 39 页。",
    path: root + "/6370-SOO-01.pdf",
    source: "项目页 · 业主要求",
  },
  {
    id: "RC-SPEC",
    projectId: "RCJM1",
    title: "BMS 技术规格书",
    kind: "原始资料",
    format: "PDF",
    version: "项目页登记版",
    summary: "BMS 技术要求，项目页登记为 61 页。",
    path: root + "/技术规格书-翟桃发(1)/4.2.4.13 BMS Spec.pdf",
    source: "项目页 · 业主要求",
  },
  {
    id: "RC-DRAW",
    projectId: "RCJM1",
    title: "图纸与 HLI 资料目录",
    kind: "原始资料",
    format: "目录",
    version: "项目页登记版",
    summary:
      "分期总平面、漏水检测、HLI 点表及建筑、结构、电气、暖通、油路图纸。",
    path: root + "/racks central图纸",
    source: "项目页 · 图纸",
  },
  {
    id: "DEMO-SPEC",
    projectId: "DEMO-026",
    title: "技术规格书",
    kind: "原始资料",
    format: "样本",
    version: "V6",
    summary: "主备、协议、报表与视频要求；用于 F3S 人审演示。",
    path: "",
    source: "合成演示样本",
  },
  {
    id: "DEMO-ARTIFACT",
    projectId: "DEMO-026",
    title: "软件评审工件",
    kind: "工件",
    format: "工作区",
    version: "V6",
    summary: "客户应答、澄清、研发路径与服务器演算的独立评审。",
    path: "",
    source: "合成演示样本",
  },
];
export const rackIssues = [
  {
    id: "RC-MARK",
    title: "点表非数值标记",
    text: "PLC-Mech 含 / 等非数值标记，含义未确认；595,644 为数值测点合计，不覆盖这些标记。",
    category: "点表口径",
  },
  {
    id: "RC-DCOM-SCOPE",
    title: "DCOM 交付范围",
    text: "功能清单、部署方案尚有补充项；首轮标准版上线与定制功能交付边界需确认。",
    category: "软件范围",
  },
  {
    id: "RC-OS",
    title: "Server OS 偏离",
    text: "Linux / PostgreSQL 配置与招标 Windows / SQL Server 要求存在偏离，待书面确认。",
    category: "技术澄清",
  },
  {
    id: "RC-NET",
    title: "交换机供货口径",
    text: "IT 数据网复用与配置表自供交换机口径需核对。",
    category: "范围澄清",
  },
  {
    id: "RC-AUTH",
    title: "设备授权口径",
    text: "测点规模与设备授权属于不同口径，覆盖关系需与研发确认。",
    category: "软件容量",
  },
  {
    id: "RC-DATE",
    title: "分期交付日期",
    text: "PTC 全部三期完成日期与 App 4 分期 RFS 存在差异，待核实。",
    category: "工期风险",
  },
];
export function fileHref(path: string) {
  return "file://" + path.split("/").map(encodeURIComponent).join("/");
}

export const rackStageResources: Record<string, string[]> = {
  F1: ["RC-NOTE", "RC-SPEC", "RC-DRAW"],
  F2: ["RC-SPEC", "RC-PTC"],
  F3: ["RC-POINT", "RC-BA"],
  F4: ["RC-CONFIG", "RC-BA"],
  F5: ["RC-SPEC", "RC-PTC", "RC-CONFIG", "RC-DCOM"],
  F6: ["RC-NOTE"],
  F7: ["RC-CONFIG", "RC-BA"],
  F8: ["RC-CONFIG"],
  F9: ["RC-NOTE"],
  F10: ["RC-PTC", "RC-SPEC"],
  F11: ["RC-PTC", "RC-NOTE"],
  F12: ["RC-NOTE"],
  F13: ["RC-NOTE"],
  F14: ["RC-CONFIG", "RC-BA", "RC-POINT", "RC-PTC"],
};
export const rackStageIssues: Record<string, string[]> = {
  F3: ["RC-AUTH", "RC-MARK"],
  F4: ["RC-NET"],
  F5: ["RC-OS", "RC-AUTH", "RC-DCOM-SCOPE"],
  F10: ["RC-DATE"],
  F11: ["RC-DATE", "RC-NET"],
  F12: ["RC-DATE"],
  F14: ["RC-OS", "RC-NET", "RC-AUTH", "RC-DATE"],
};
