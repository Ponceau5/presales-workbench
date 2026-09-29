import type { LogEntry } from "@/lib/projectChanges";
/** Fictional walkthrough records. Never used as approved facts or actual customer history. */
export const sampleChanges: Record<string, LogEntry[]> = {
  "DEMO-026": [
    {
      id: "DC-S02",
      title: "采集周期调整",
      before: "温度采集周期：30 秒。\n历史保留：12 个月。",
      after: "温度采集周期：10 秒。\n历史保留：12 个月。",
      version: "需求 V4 → V5",
      owner: "软件产品 / 研发",
      affected: ["F2", "F5"],
      source: "模拟记录 · 09/26 15:40",
      status: "待复核",
    },
    {
      id: "DC-S01",
      title: "点表区域命名统一",
      before: "区域名称：机房一 / A 区。\n影响数量：无。",
      after: "区域名称：统一为 A 区。\n影响数量：无。",
      version: "点表 V1 → V2",
      owner: "解决方案",
      affected: ["F1", "F3"],
      source: "模拟记录 · 09/24 09:30",
      status: "已关闭",
    },
  ],
};
