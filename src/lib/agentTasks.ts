import { stagesForProject } from "./projectStages";
import { stageRowOwner } from "./accounts";
import type { ReferenceItem } from "./referenceReview";
export type AgentTaskKind = "extract" | "check" | "draft" | "handoff";
export interface AgentArtifact {
  id: string;
  title: string;
  text: string;
  requirement: string;
  source: string;
  owner: string;
  blocker?: string;
  resolution?: string;
  revision: number;
  category?: string;
  context?: string;
  pendingDependencies?: boolean;
  followupTarget?: { id: string; owner: string };
  capability?: string;
  implementation?: string;
  costBasis?: string;
}
export interface AgentFinding {
  title: string;
  text: string;
  source: string;
  status: "依据" | "待确认" | "建议";
}
export interface AgentResult {
  task: AgentTaskKind;
  label: string;
  request: string;
  artifactId: string;
  revision: number;
  inputText: string;
  inputResolution: string;
  inputContext: string;
  inputSources: string[];
  at: string;
  findings: AgentFinding[];
  proposal?: string;
  followup?: { title: string; owner: string };
}
const labels: Record<string, string[]> = {
  F1: ["识别项目与版本", "核对资料缺项", "整理项目档案", "准备专业任务"],
  F2: ["拆解专业要求", "识别范围歧义", "整理要求清单", "准备专业交接"],
  F3: ["统计点表口径", "核对接口与预留", "整理配置候选", "检查下游影响"],
  F4: ["提取选型条件", "检查型号与配件", "整理选型清单", "准备询价输入"],
  F6: ["提取清关条件", "检查证明与授权", "整理出口检查表", "准备跨岗位确认"],
  F7: ["汇集配置变更", "核对询价缺项", "整理成本底表", "准备销售报价初稿"],
  F8: ["选择客户 BOQ 分项", "核对内部物料对应", "记录拆分规则并分配数量", "核对客户金额与差异"],
  F9: ["提取物料明细", "检查报价完整性", "整理评审材料", "准备审批交接"],
  F10: ["汇集提交工件", "检查附件与批准", "整理提交清单", "准备提交确认"],
  F11: ["提取客户反馈", "检查范围一致性", "整理谈判事项", "准备合同评审"],
  F12: ["定位条款事实", "检查风险与偏离", "整理风险初稿", "准备专业评审"],
  F13: ["提取付款条件", "检查测算输入", "整理现金流输入", "准备输入追收"],
};
const softwareLabels: Record<string, string[]> = {
  客户应答: [
    "定位要求与依据",
    "核对能力与确认输入",
    "起草客户应答",
    "准备澄清与交接",
  ],
  澄清: ["定位歧义", "检查答复缺项", "起草澄清问题", "检查答复影响"],
  研发路径: [
    "提取技术约束",
    "检查能力与成本依据",
    "比较实现方案",
    "准备产品确认",
  ],
  服务器: [
    "提取容量与部署条件",
    "检查模型参数",
    "整理规格候选",
    "准备配置交接",
  ],
};
const roleLabels: Record<string, string[]> = {
  "F1:商务支持": [
    "识别资料版本",
    "检查资料完整性",
    "整理版本登记",
    "准备专业资料包",
  ],
  "F7:财务 / 风控": [
    "提取成本条件",
    "检查成本口径",
    "整理成本缺口",
    "准备财务反馈",
  ],
  "F9:财务 / 风控": [
    "提取报价条件",
    "核对币种与税费",
    "整理财务评审",
    "准备审批意见",
  ],
  "F12:财务 / 风控": [
    "提取付款与担保条款",
    "检查资金与赔偿风险",
    "整理财务风险意见",
    "准备商务反馈",
  ],
  "F12:认证 / 法务": [
    "定位合同条款",
    "检查责任与偏离",
    "整理法律评审意见",
    "准备条款反馈",
  ],
  "F6:认证 / 法务": [
    "定位认证与授权条件",
    "检查适用证明",
    "整理认证缺口",
    "准备关务反馈",
  ],
};
const checks: Record<string, string[]> = {
  F1: [
    "项目编号与客户主体",
    "专业范围与商机来源",
    "资料提供人及版本",
    "最新附件及缺失清单",
  ],
  F2: [
    "条款编号与原文",
    "专业归属与接口边界",
    "能力匹配依据",
    "客户或厂家答复",
  ],
  F3: [
    "区域与系统划分",
    "数值测点及非数值标记",
    "接口/模块容量与预留",
    "柜型及厂家确认",
  ],
  F4: [
    "型号和有效产品资料",
    "功能、精度及环境条件",
    "接口、尺寸和安装方式",
    "物料号、必配附件与数量",
  ],
  F6: [
    "进口主体与资质",
    "贸易条件及包装方式",
    "品牌授权和申报要素",
    "认证适用性与专业意见",
  ],
  F7: [
    "批准配置与变更增量",
    "供应商报价及有效期",
    "币种、交期和交付条件",
    "硬件/软件/服务/物流成本口径",
  ],
  F8: [
    "客户 BOQ 行号与单位",
    "内部物料号与数量",
    "一对多/合并拆分规则",
    "数量差异及价格分摊依据",
  ],
  F9: [
    "CRM 物料号及数量",
    "批准价格与币种",
    "税费、运费与付款条件",
    "变更行和重新审批范围",
  ],
  F10: [
    "提交截止与渠道",
    "签章及授权文件",
    "专业工件批准状态",
    "偏离附件与提交回执",
  ],
  F11: [
    "客户反馈原文与日期",
    "范围/价格/交期变动",
    "报价与合同附件一致性",
    "书面确认与谈判记录",
  ],
  F12: [
    "合同有效版本",
    "付款、担保与验收条款",
    "延期责任与赔偿上限",
    "范围偏离及分别签署的专业意见",
  ],
  F13: [
    "PM 收入时间计划",
    "采购与供应链支出计划",
    "付款比例、账期与币种",
    "税费、汇率及资金占用假设",
  ],
};
export function taskOptions(stage: string, category?: string, owner?: string) {
  const names =
    owner === "PM / PO"
      ? ["读取工件状态", "核对阻塞与责任", "整理协作清单", "分派专业跟进"]
      : roleLabels[stage + ":" + owner] ||
        (stage === "F5"
          ? softwareLabels[category || "客户应答"]
          : labels[stage]);
  return (["extract", "check", "draft", "handoff"] as AgentTaskKind[]).map(
    (kind, index) => ({ kind, label: (names || labels.F2)[index] }),
  );
}
export function softwareArtifact(
  item: ReferenceItem,
  row: {
    text: string;
    resolution: string;
    revision: number;
    implementation?: string;
    costBasis?: string;
    extraction?: { requirement: string };
  },
): AgentArtifact {
  return {
    id: item.id,
    title: item.title,
    text: row.text,
    requirement: row.extraction?.requirement || item.requirement,
    source: item.source,
    owner: item.owner,
    blocker: item.blocker,
    resolution: row.resolution,
    revision: row.revision,
    category: item.category,
    capability: item.capability,
    implementation: row.implementation,
    costBasis: row.costBasis,
  };
}
export function stageArtifact(
  projectId: string,
  stage: string,
  index: number,
  text?: string,
  revision = 1,
  resolution?: string,
): AgentArtifact {
  const def = stagesForProject(projectId).find((s) => s.id === stage)!;
  const row = def.outputs[index];
  return {
    id: stage + ":" + index,
    title: row.title,
    text: text || row.text,
    requirement: def.goal,
    source: row.evidence,
    owner: stageRowOwner(stage, index) || def.owner,
    blocker: def.question,
    resolution,
    revision,
  };
}
export function inferTask(request: string): AgentTaskKind {
  if (/交接|下游|影响|派|跟进|谁/.test(request)) return "handoff";
  if (/起草|草稿|生成|改写|润色|修改为|改成/.test(request)) return "draft";
  if (/缺|风险|歧义|满足|核对|检查|成本|是否/.test(request)) return "check";
  return "extract";
}
export function executeAgentTask(
  projectId: string,
  stage: string,
  artifact: AgentArtifact,
  task: AgentTaskKind,
  request: string,
  sources: string[],
  actorRole?: string,
): AgentResult {
  const label = taskOptions(
    stage,
    artifact.category,
    actorRole === "PM / PO" ? actorRole : artifact.owner,
  ).find((t) => t.kind === task)!.label;
  const def = stagesForProject(projectId).find((s) => s.id === stage);
  const needsConfirmation =
    artifact.pendingDependencies ||
    (!!artifact.blocker && !artifact.resolution?.trim());
  const unsafeCommitment =
    needsConfirmation &&
    /直接.*满足|改成.*满足|无条件.*满足|保证|直接.*批准|绕过/.test(request);
  const sourceSelected = sources.includes(artifact.source);
  const artifactSelected = sources.some((s) =>
    s.startsWith(artifact.title + " · R"),
  );
  const findings: AgentFinding[] = [];
  if (!sources.length)
    findings.push({
      title: "输入未指定",
      text: "请选择资料或已确认工件后重新执行。",
      source: "本次输入",
      status: "待确认",
    });
  else if (task === "extract") {
    if (sourceSelected)
      findings.push({
        title: artifact.category === "研发路径" ? "实现约束" : "原文要求",
        text: artifact.requirement,
        source: artifact.source,
        status: "依据",
      });
    if (artifactSelected)
      findings.push({
        title: "当前工件",
        text: artifact.text,
        source: `${artifact.id} · V${artifact.revision}`,
        status: "依据",
      });
    if (sourceSelected && stage === "F3" && projectId === "RCJM1")
      findings.push({
        title: "点表统计",
        text: "四分表数值测点合计 595,644；PLC-Elect 第 41 行为 7,776 × 66 = 513,216。非数值标记未计入，不换算为一个测点。",
        source: "BMS Point Schedule 2026-04-13 · PLC-Elect 行41",
        status: "依据",
      });
  } else if (task === "check") {
    if (stage === "F5") {
      findings.push({
        title: "产品能力",
        text:
          artifact.capability ||
          "当前输入没有已批准的产品能力说明或测试记录，规格要求不能作为产品支持证明。",
        source: artifact.capability ? "产品能力基线" : "本次输入",
        status: artifact.capability ? "依据" : "待确认",
      });
      if (artifact.category === "研发路径")
        findings.push({
          title: "实现与成本选择",
          text:
            artifact.implementation && artifact.costBasis
              ? artifact.implementation + "：" + artifact.costBasis
              : "先核对标准组件复用，再比较接口适配、定制开发与第三方采购；分别记录开发工时、许可费和交付约束后选定路径。",
          source: artifact.id,
          status: artifact.costBasis ? "依据" : "待确认",
        });
    }
    findings.push({
      title: needsConfirmation ? "尚缺确认依据" : "复核范围",
      text: needsConfirmation
        ? artifact.blocker || "关联确认尚未完成"
        : artifact.resolution ||
          "核对原文、产品能力和本条工件，不替代责任岗位批准。",
      source: artifact.source,
      status: needsConfirmation ? "待确认" : "建议",
    });
    findings.push({
      title: "责任与输出",
      text: `${artifact.owner}复核「${artifact.title}」；${stage === "F5" && artifact.category === "研发路径" ? "成本与工时缺依据时保留待估，客户应答由软件产品另行确认。" : stage === "F13" ? "缺支出计划、回款日期及税费输入时不输出峰值垫资或转正月份。" : "未确认的条件继续保留在工件中。"}`,
      source: artifact.id,
      status: "建议",
    });
  } else if (task === "draft" && actorRole === "PM / PO") {
    findings.push({
      title: "专业协作",
      text: `${artifact.owner}负责「${artifact.title}」；${needsConfirmation ? "先补齐：" + artifact.blocker : "核对现有确认记录后继续复核"}。`,
      source: artifact.source,
      status: needsConfirmation ? "待确认" : "建议",
    });
    findings.push({
      title: "后续交接",
      text:
        stage === "F5"
          ? "客户应答、研发路径、服务器规格分别由软件产品、研发、解决方案复核，协调不替代专业批准。"
          : `后续环节 ${def?.next.join(" / ") || "项目计划"}，保留版本与责任岗位。`,
      source: artifact.id,
      status: "建议",
    });
  } else if (task === "draft") {
    findings.push({
      title: unsafeCommitment ? "承诺条件未成立" : "草稿范围",
      text: unsafeCommitment
        ? "当前问题尚未澄清，不能将应答改为无条件满足。先取得答复和依据，再复核相应工件。"
        : `为「${artifact.title}」整理候选内容，其他工件不变。`,
      source: artifact.source,
      status: unsafeCommitment ? "待确认" : "建议",
    });
  } else {
    findings.push({
      title: "交接对象",
      text:
        stage === "F5"
          ? artifact.category === "研发路径"
            ? "软件产品核对实现边界后，更新对应客户应答；解决方案同步服务器或配置影响。"
            : artifact.category === "服务器"
              ? "解决方案复核规格与配置，销售/财务核对成本输入。"
              : "研发确认产品能力与实现范围；客户答复由软件产品登记并复核。"
          : `后续环节：${def?.next.join(" / ") || "项目决策与计划更新"}。仅交接已确认内容，未完成项随工件保留。`,
      source: artifact.id,
      status: "建议",
    });
    findings.push({
      title: "当前阻塞",
      text: needsConfirmation
        ? artifact.blocker || "关联确认尚未完成"
        : "本条无未登记的阻塞项；仍需责任岗位批准与写回。",
      source: artifact.source,
      status: needsConfirmation ? "待确认" : "建议",
    });
  }
  if (sources.length && task === "check" && stage !== "F5")
    findings.push({
      title: "核对字段",
      text: (checks[stage] || []).join("；"),
      source: def?.source || artifact.source,
      status: "建议",
    });
  if (sources.length && artifact.context)
    findings.push({
      title: stage === "F5" ? "关联确认与能力依据" : "参数与专业答复",
      text: artifact.context,
      source: "工作区参数 / 关联跟进记录",
      status: "待确认",
    });
  const proposal =
    task === "draft" &&
    actorRole !== "PM / PO" &&
    (sourceSelected || artifactSelected) &&
    !unsafeCommitment
      ? `${artifact.text}${needsConfirmation && !artifact.text.includes(artifact.blocker || "关联确认尚未完成") ? "\n待确认：" + artifact.blocker : ""}${artifact.context && artifact.category !== "客户应答" ? "\n关联输入（待复核）：" + artifact.context : ""}`
      : undefined;
  return {
    task,
    label,
    request,
    artifactId: artifact.id,
    inputText: artifact.text,
    inputContext: artifact.context || "",
    inputSources: [...sources],
    inputResolution: artifact.resolution || "",
    revision: artifact.revision,
    at: new Date().toISOString(),
    findings,
    proposal,
    followup:
      (needsConfirmation || task === "handoff") && sources.length
        ? {
            title: `${artifact.title}：${needsConfirmation ? artifact.blocker : "后续专业协作"}`,
            owner:
              artifact.followupTarget?.owner ||
              (artifact.category === "澄清"
                ? "销售"
                : artifact.category === "研发路径"
                  ? "软件产品"
                  : artifact.owner),
          }
        : undefined,
  };
}
