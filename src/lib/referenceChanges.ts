import type { LogEntry } from "@/lib/projectChanges";
/** Technical history documented in the 2026-09-15 project note, not a binary workbook diff. */
const records: LogEntry[] = [
  {
    id: "RC-N0906-SRV",
    title: "服务器选型与北向服务调整",
    before: "服务器：DELL R760。\n北向专用服务器：0 台。",
    after: "服务器：H3C R4900 G7。\n北向专用服务器：2 台。",
    version: "07/20 → 09/06",
    owner: "解决方案 / 软件产品",
    affected: ["F4", "F5", "F7", "F8"],
    source: "原始配置表 · 2026-07-20 / 2026-09-06",
    status: "待复核",
  },
  {
    id: "RC-N0906-GW",
    title: "采集网关数量调整",
    before: "PMC-1606 网关：142 台。",
    after: "PMC-1606 网关：240 台。\n与点表设备口径的覆盖关系待核对。",
    version: "07/20 → 09/06",
    owner: "解决方案",
    affected: ["F3", "F4", "F5", "F7", "F8"],
    source: "原始配置表 · 2026-07-20 / 2026-09-06",
    status: "待复核",
  },
  {
    id: "RC-N0906-H2",
    title: "氢气探测器纳入配置",
    before: "氢气探测器：0 台。",
    after: "氢气探测器：150 台。\n数量与点表的对应关系待复核。",
    version: "07/20 → 09/06",
    owner: "解决方案 / 硬件产品",
    affected: ["F3", "F4", "F7", "F8"],
    source: "原始配置表 · 2026-07-20 / 2026-09-06",
    status: "待复核",
  },
  {
    id: "RC-N0906-UPS",
    title: "UPS 供货范围调整",
    before: "UPS：100 台，由我方供货。",
    after: "UPS：改为客户供货。\n接线、调试与接口范围需同步核对。",
    version: "07/20 → 09/06",
    owner: "销售 / 解决方案",
    affected: ["F4", "F7", "F8", "F11"],
    source: "原始配置表 · 2026-07-20 / 2026-09-06",
    status: "待复核",
  },
];

const snapshot = (side: "before" | "after") =>
  [
    "Racks Central · 配置版本登记",
    "文件范围：服务器、北向服务、采集网关、氢气探测器、UPS",
    "",
    ...records.flatMap((r) => [r.title, r[side], ""]),
    "关联资料：BMS Point Schedule、BA 点表与配置清单",
    "复核责任：解决方案、硬件产品、软件产品、销售",
  ].join("\n");
export const referenceChanges: LogEntry[] = records.map((r) => ({
  ...r,
  documentTitle: "BMS / DCOM 配置清单",
  documentBefore: snapshot("before"),
  documentAfter: snapshot("after"),
}));
