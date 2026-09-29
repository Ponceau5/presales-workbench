export interface ReferenceItem {
  id: string;
  title: string;
  category: "客户应答" | "澄清" | "研发路径" | "服务器";
  requirement: string;
  draft: string;
  document: "bms-spec" | "dcom-requirements";
  page: number;
  source: string;
  owner: string;
  blocker?: string;
  dependsOn?: string[];
  requirementType?: "原则" | "接入" | "功能";
  capability?: string;
}
export const referenceItems: ReferenceItem[] = [
  {
    id: "RC-R01",
    dependsOn: ["RC-D01"],
    category: "客户应答",
    title: "OPC 双向接口",
    requirement:
      "BAS 既作为 OPC server，也作为 OPC client；架构使用 COM/DCOM 与 OPC。",
    draft:
      "建议应答：BMS 通过 OPC 客户端采集第三方系统数据，通过 OPC 服务端提供监控数据；接口清单按系统列出读写范围、数据类型及刷新周期。COM/DCOM 运行环境与第三方互通结果纳入联调记录，复核后形成正式答复。",
    document: "bms-spec",
    page: 5,
    source: "BMS Spec · PDF p.5 / TS-02 p.1",
    owner: "软件产品",
  },
  {
    id: "RC-R02",
    dependsOn: ["RC-S01"],
    category: "客户应答",
    title: "历史数据保留",
    requirement:
      "服务器与 historian 至少支持两年数据存储；若当地要求更严格，以更严格要求为准。",
    draft:
      "建议应答：历史数据按不少于两年设计，趋势、告警与操作记录分开存储。按测点类型配置采集周期与变化入库策略，历史查询与归档恢复纳入验收测试；最终容量按批准后的参数及当地要求复核。",
    document: "bms-spec",
    page: 6,
    source: "BMS Spec · PDF p.6 / TS-02 p.2",
    owner: "软件产品",
    blocker: "采集与存储参数、适用要求未确认",
  },
  {
    id: "RC-R03",
    category: "客户应答",
    title: "浏览器访问性能",
    requirement: "浏览器画面 4 秒内显示，数据 2 秒内更新；远程访问需密码保护。",
    draft:
      "建议应答：浏览器画面按 4 秒显示、2 秒数据更新目标设计；采用分区域加载和增量刷新，所有远程访问采用账号认证。验收需记录并发用户、网络条件、页面测点数与响应时间，性能结果复核后承诺。",
    document: "bms-spec",
    page: 16,
    source: "BMS Spec · PDF p.16 / TS-02 p.12",
    owner: "软件产品",
    blocker: "并发与测试规模、性能证据未确认",
  },
  {
    id: "RC-R04",
    dependsOn: ["RC-Q02", "RC-Q03", "RC-D02"],
    category: "客户应答",
    title: "PTW 前置与关闭流程",
    requirement:
      "MOS/RA 必须先审核；实施人发起完工，主管复核，EHS / 安保最终关闭。",
    draft:
      "建议应答：工作许可关联 MOS/RA 审查，审批通过后进入 PTW；完工按实施人提交、主管复核、EHS/安保关闭流转。各节点保留责任人、时间与附件，外部供应商只可查看授权范围。已有能力与新增开发在范围清单中分列。",
    document: "dcom-requirements",
    page: 1,
    source: "RC DCOM需求分析_v2 · ¶263–265",
    owner: "软件产品",
    blocker: "产品覆盖及研发范围未确认",
  },
  {
    id: "RC-Q01",
    category: "澄清",
    title: "服务器操作系统名称",
    requirement:
      "原文写明 Microsoft Window 11 Server (min 5 users)，SQL Server 2022 or above。",
    draft:
      "请确认“Microsoft Window 11 Server”所指的正式操作系统与版本；Linux / PostgreSQL 方案是否接受，请提供书面确认。",
    document: "bms-spec",
    page: 6,
    source: "BMS Spec · PDF p.6 / TS-02 p.2",
    owner: "软件产品",
    blocker: "操作系统名称与偏离接受性未确认",
  },
  {
    id: "RC-Q02",
    category: "澄清",
    title: "DCOM 功能范围",
    requirement:
      "文档保留“总功能列表…补充，标注哪些已有，哪些新开发，哪些优化”；部署方案仍为补充项。",
    draft: "请补齐已有 / 新增 / 优化功能划分，明确验收范围与部署方案。",
    document: "dcom-requirements",
    page: 1,
    source: "RC DCOM需求分析_v2 · ¶93–95",
    owner: "软件产品",
    blocker: "功能清单与部署方案未定稿",
  },
  {
    id: "RC-Q03",
    category: "澄清",
    title: "首轮上线范围",
    requirement:
      "目标为开发和优化部分功能；上线方案写明当前版本不做任何改动部署到现场。",
    draft: "请确认标准版本先上线与定制功能后续交付的阶段边界、日期及验收条件。",
    document: "dcom-requirements",
    page: 1,
    source: "RC DCOM需求分析_v2 · 项目目标 / ¶459–460",
    owner: "软件产品",
    blocker: "定制功能与首轮上线边界未确认",
  },
  {
    id: "RC-D01",
    category: "研发路径",
    title: "OPC 兼容验证路径",
    requirement: "开放系统要求 OPC 双向通信，规格同时引用 COM/DCOM。",
    draft:
      "建议路径：① 复用现有采集与接口组件，整理 OPC server/client 覆盖；② 建立第三方联调样例，验证 COM/DCOM、点类型及断线恢复；③ 缺口仅在适配层开发，不重建采集核心；④ 比较复用、适配与第三方方案的工时、许可费及维护成本。",
    document: "bms-spec",
    page: 5,
    source: "BMS Spec · PDF p.5；内部验证建议",
    owner: "研发",
    blocker: "缺现有产品能力与成本工时依据",
  },
  {
    id: "RC-D02",
    dependsOn: ["RC-Q02", "RC-Q03"],
    category: "研发路径",
    title: "PTW 工作流复用",
    requirement: "MOS/RA 前置审查，多级审批与关闭；外部供应商及内部岗位参与。",
    draft:
      "建议路径：复用 DCOM 表单、工作流和账号体系，新增 MOS/RA 前置门控、PTW 角色审批及多级关闭。首轮沿用标准版本做现场初始化；定制部分按功能差距单独排期。交付样例覆盖正常审批、驳回、完工与关闭，研发确认工作量后比较成本。",
    document: "dcom-requirements",
    page: 1,
    source: "RC DCOM需求分析_v2 · PTW；内部验证建议",
    owner: "研发",
    blocker: "缺能力差距与工时估算，尚不能称为最低成本结论",
  },
  {
    id: "RC-S01",
    category: "服务器",
    title: "两年历史存储容量",
    requirement:
      "至少两年历史存储；原表数值测点 595,644，不等于全部测点均按同一周期入库。",
    draft:
      "配置参考：BMS 主备采集 2 台、主备数据库 2 台、主备北向 2 台；H3C R4900G7，6515P ×2，256GB，RAID5。两年历史数据按下方演算口径估算；磁盘容量、采集参数与压测模型复核后确定。",
    document: "bms-spec",
    page: 6,
    source: "BMS Spec · PDF p.6；BMS Point Schedule 2026-04-13",
    owner: "解决方案",
    blocker: "缺容量参数与正式服务器模型",
  },
  {
    id: "RC-S02",
    dependsOn: ["RC-Q01"],
    category: "服务器",
    title: "硬件规格适用性",
    requirement:
      "原文同时出现 Xeon、DDR2、SCSI、PCI/ISA 等旧硬件描述与 SQL Server 2022。",
    draft:
      "等效方案参考：H3C R4900G7 / 双 6515P / 256GB / RAID5；BMS 6 台、DCIM 主备 2 台，工作站 DELL T3680 2 台。将性能、冗余、存储与运维响应逐项对照招标要求；Linux/PostgreSQL 偏离单列提交确认。",
    document: "bms-spec",
    page: 6,
    source: "BMS Spec · PDF p.6 / TS-02 p.2",
    owner: "解决方案",
    blocker: "旧硬件要求与当前基准未澄清",
  },
];
export interface ReferenceReviewRow {
  text: string;
  evidence: string;
  resolution: string;
  note: string;
  status: "waiting" | "approved" | "rejected";
  written: boolean;
  revision: number;
  extraction?: {
    runId: string;
    at: string;
    source: string;
    requirement: string;
    status: "candidate" | "confirmed";
    reviewer?: string;
  };
  disposition?: "满足" | "偏离" | "不满足" | "待澄清";
  dependencyVersions?: Record<string, number>;
  implementation?: "复用" | "适配" | "定制" | "第三方";
  costBasis?: string;
}
export interface ReferenceAudit {
  id: string;
  at: string;
  target: string;
  actor: string;
  action: string;
  before: string;
  after: string;
  note: string;
  source: string;
  revision: number;
}
export interface ReferenceReviewState {
  sourceVersion?: number;
  rows: Record<string, ReferenceReviewRow>;
  audit: ReferenceAudit[];
}
export function initialReferenceReview(
  items = referenceItems,
): ReferenceReviewState {
  return {
    rows: Object.fromEntries(
      items.map((i) => [
        i.id,
        {
          text: i.draft,
          evidence: "",
          resolution: "",
          note: "",
          status: "waiting",
          written: false,
          revision: 1,
        },
      ]),
    ),
    audit: [],
  };
}
export function dependencyGate(
  item: ReferenceItem,
  state: ReferenceReviewState,
) {
  for (const id of item.dependsOn || []) {
    const row = state.rows[id];
    if (!row?.written || row.status !== "approved")
      return "关联工件尚未确认：" + id;
    const bound = state.rows[item.id]?.dependencyVersions?.[id];
    if (bound !== undefined && bound !== row.revision)
      return "关联工件已更新：" + id;
  }
  return "";
}

export function referenceGate(
  item: ReferenceItem,
  row: ReferenceReviewRow,
  actor: string,
) {
  if (item.category === "客户应答" && row.extraction?.status !== "confirmed")
    return "先对照原文核对提取要求";
  if (
    item.category === "研发路径" &&
    (!row.implementation || !row.costBasis?.trim())
  )
    return "补充实现方式与成本比较依据";
  if (
    item.category === "客户应答" &&
    (!row.disposition || row.disposition === "待澄清")
  )
    return "请选择应答结论；待澄清内容不能发布";
  if (actor !== item.owner) return "由" + item.owner + "复核";
  if (!row.text.trim() || !row.note.trim() || !row.evidence.trim())
    return "补充内容、复核意见与依据";
  if (item.blocker && !row.resolution.trim()) return "待确认：" + item.blocker;
  return "";
}
export function referenceAction(
  s: ReferenceReviewState,
  id: string,
  action:
    | "extract"
    | "verify"
    | "edit"
    | "respond"
    | "approve"
    | "reject"
    | "write",
  actor: string,
  patch: Partial<ReferenceReviewRow>,
  accountId?: string,
  items = referenceItems,
): ReferenceReviewState {
  const item = items.find((i) => i.id === id);
  const old = s.rows[id];
  if (
    (action === "approve" || action === "write") &&
    items.some(
      (root) =>
        root.category === "客户应答" &&
        root.dependsOn?.includes(id) &&
        s.rows[root.id].extraction?.status !== "confirmed",
    )
  )
    return s;
  if (!item || !old || !actor.trim() || actor !== item.owner) return s;
  const next = {
    ...old,
    extraction:
      action === "extract" || action === "verify"
        ? patch.extraction
        : old.extraction,
    disposition: patch.disposition ?? old.disposition,
    implementation: patch.implementation ?? old.implementation,
    costBasis: patch.costBasis ?? old.costBasis,
    text: patch.text ?? old.text,
    evidence: patch.evidence ?? old.evidence,
    resolution: patch.resolution ?? old.resolution,
    note: patch.note ?? old.note,
  };
  if ((action === "approve" || action === "write") && dependencyGate(item, s))
    return s;
  if (action === "approve" && referenceGate(item, next, actor)) return s;
  if (
    action === "write" &&
    (old.status !== "approved" || referenceGate(item, old, actor))
  )
    return s;
  if (action === "reject" && (!next.note.trim() || actor !== item.owner))
    return s;
  if ((action === "edit" || action === "respond") && !next.text.trim())
    return s;
  if (
    action === "respond" &&
    (!next.resolution.trim() || !next.evidence.trim())
  )
    return s;
  if (action === "edit" || action === "respond") {
    next.status = "waiting";
    next.written = false;
    next.revision = old.revision + 1;
  }
  if (action === "extract" || action === "verify") {
    if (
      !patch.extraction?.requirement.trim() ||
      !patch.extraction.runId ||
      patch.extraction.source !== item.source
    )
      return s;
    next.extraction = {
      ...patch.extraction,
      status: action === "verify" ? "confirmed" : "candidate",
      reviewer: action === "verify" ? accountId || actor : undefined,
    };
    next.status = "waiting";
    next.written = false;
    next.revision = old.revision + 1;
  }
  if (action === "approve") {
    next.status = "approved";
    next.dependencyVersions = Object.fromEntries(
      (item.dependsOn || []).map((id) => [id, s.rows[id].revision]),
    );
  }
  if (action === "reject") {
    next.status = "rejected";
    next.written = false;
  }
  if (action === "write") next.written = true;
  const rows = { ...s.rows, [id]: next };
  if (
    action === "edit" ||
    action === "respond" ||
    action === "reject" ||
    action === "extract" ||
    action === "verify"
  ) {
    const impacted = new Set([id]);
    if (
      (action === "extract" || action === "verify") &&
      item.category === "客户应答"
    ) {
      for (const dependency of item.dependsOn || []) {
        impacted.add(dependency);
        rows[dependency] = {
          ...rows[dependency],
          status: "waiting",
          written: false,
          dependencyVersions: undefined,
        };
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const dependent of items) {
        if (
          impacted.has(dependent.id) ||
          !dependent.dependsOn?.some((d) => impacted.has(d))
        )
          continue;
        impacted.add(dependent.id);
        rows[dependent.id] = {
          ...rows[dependent.id],
          status: "waiting",
          written: false,
          dependencyVersions: undefined,
        };
        changed = true;
      }
    }
    next.dependencyVersions = undefined;
  }
  return {
    ...s,
    rows,
    audit: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        target: id,
        actor: accountId ? accountId + " · " + actor : actor,
        action,
        before:
          action === "extract" || action === "verify"
            ? old.extraction?.requirement || item.requirement
            : old.text,
        after:
          action === "extract" || action === "verify"
            ? next.extraction!.requirement
            : next.text,
        note: next.note,
        source: item.source,
        revision: next.revision,
      },
      ...s.audit,
    ],
  };
}
