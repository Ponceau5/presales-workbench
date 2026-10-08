import { NodeAgent } from "@/components/NodeAgent";
import { readProjectReview } from "@/lib/projectReview";
import { stageGuide } from "@/lib/stageGuide";
import { ChangeLog } from "@/components/ChangeLog";
import { useProjectChanges } from "@/lib/projectChanges";
import {
  rackStageResources,
  rackStageIssues,
  rackIssues,
} from "@/lib/portfolio";
import { useState, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, Check, Focus } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { pipelineSteps } from "@/lib/presales";
import { stagesForProject } from "@/lib/projectStages";
import { stageFlow } from "@/lib/workflowEngine";
import { roleWork } from "@/lib/workspace";
import { boqGroupIssues, boqGroups, commercialReadiness, inventoryFor, readCommercialState } from "@/lib/commercialWorkflow";
import { Tag } from "@/components/WorkbenchUI";
const positions: Record<string, [number, number]> = {
  F1: [20, 160],
  F2: [205, 160],
  F3: [430, 85],
  F4: [430, 170],
  F5: [430, 255],
  F6: [205, 20],
  F7: [700, 170],
  F8: [20, 460],
  F9: [225, 460],
  F10: [430, 460],
  F11: [700, 460],
  F12: [430, 620],
  F13: [700, 620],
  F14: [20, 760],
};
const edges = [
  { from: "F1", to: "F2", path: "M170 198 H205" },
  { from: "F2", to: "F3", path: "M355 198 H400 V123 H430" },
  { from: "F2", to: "F4", path: "M355 198 H400 V208 H430" },
  { from: "F2", to: "F5", path: "M355 198 H400 V293 H430" },
  { from: "F2", to: "F6", path: "M280 160 V96" },
  { from: "F3", to: "F7", path: "M580 123 H620 V208 H700" },
  { from: "F4", to: "F7", path: "M580 208 H700" },
  { from: "F5", to: "F7", path: "M580 293 H620 V208 H700" },
  { from: "F6", to: "F7", path: "M355 58 H775 V170", condition: true },
  { from: "F6", to: "F11", path: "M280 20 V8 H950 V498 H850", condition: true },
  { from: "F7", to: "F8", path: "M735 246 V420 H95 V460" },
  { from: "F8", to: "F9", path: "M170 498 H225" },
  { from: "F9", to: "F10", path: "M375 498 H430" },
  { from: "F10", to: "F11", path: "M580 498 H700" },
  { from: "F11", to: "F12", path: "M775 536 V580 H505 V620" },
  { from: "F12", to: "F13", path: "M580 658 H700" },
];
export function ProjectFlow({
  referenceProjectId,
}: { referenceProjectId?: string } = {}) {
  const { state } = useWorkbench();
  const inspector = useRef<HTMLElement>(null);
  const entries = useProjectChanges(
    referenceProjectId || state.currentProjectId,
  );
  const work = roleWork[state.role];
  const [params] = useSearchParams();
  const initialStage =
    params.get("stage") || work.stages.find((s) => s !== "F14") || "F1";
  const [selected, setSelected] = useState(initialStage);
  const guide = stageGuide[selected];
  const [focused, setFocused] = useState(false);
  const step = pipelineSteps.find((s) => s.id === selected)!;
  const stages = stagesForProject(referenceProjectId || state.currentProjectId);
  const def = stages.find((d) => d.id === selected);
  const data = state.stageStates[selected];
  const commercial = (referenceProjectId || state.currentProjectId) === 'RCJM1'
    ? readCommercialState('RCJM1') : null;
  const commercialLines = commercial ? inventoryFor(commercial.baseline) : [];
  const commercialReady = commercial ? commercialReadiness(commercial, commercialLines) : null;
  const relatedResources = referenceProjectId
    ? state.resources.filter(
        (r) =>
          r.projectId === referenceProjectId &&
          (rackStageResources[selected] || []).includes(r.id),
      )
    : [];
  const relatedIssues = referenceProjectId
    ? rackIssues.filter((i) => (rackStageIssues[selected] || []).includes(i.id))
    : [];
  const status = (id: string) => {
    const projectId = referenceProjectId || state.currentProjectId;
    const incoming = state.deliveries.filter(
      (d) =>
        d.projectId === projectId &&
        d.toStage === id &&
        d.status !== "returned",
    );
    if (incoming.some((d) => d.outdated && d.status === "accepted"))
      return "输入版本失效";
    if (incoming.some((d) => d.status === "pending" && !d.outdated))
      return "有交接待接收";
    if (id === "F5") {
      const rows = Object.values(
        readProjectReview(referenceProjectId || state.currentProjectId, state)
          .rows,
      );
      return rows.filter((r) => r.written).length === rows.length
        ? "已写回"
        : rows.some((r) => r.written || r.status === "approved")
          ? "复核中"
          : "待复核";
    }
    if (commercial && commercialReady && id === 'F7')
      return `成本 ${commercialLines.length - commercialReady.missingCosts.length}/${commercialLines.length} · ${commercial.draftPriceRm !== null && commercial.draftPriceRm !== undefined ? '初稿待复核' : '待报价'}`;
    if (commercial && commercialReady && id === 'F8')
      return `BOQ ${boqGroups.filter(group => commercial.mappings[group.id]?.confirmed && boqGroupIssues(commercial, group.id, commercialLines).ready).length}/${boqGroups.length} 已核对`;
    if (commercialReady && id === 'F9')
      return commercialReady.ready ? '录入稿就绪' : '录入稿待补';
    if (id === "F14")
      return Object.values(state.changeStatus).every((s) => s === "done") &&
        Object.values(state.stageStates).every((s) => !s.change || s.written)
        ? "已完成"
        : "待处理";
    const progress = stageFlow(state.stageStates[id], incoming, projectId, id);
    return progress.status === "published"
      ? "已写回"
      : progress.status === "ready"
        ? "待写回"
        : progress.status === "blocked"
          ? "待处理"
          : progress.status === "reviewing"
            ? "待人审"
            : "待整理";
  };
  const getRoute = (id: string) =>
    "/projects/" +
    (referenceProjectId || state.currentProjectId) +
    "?view=review&stage=" +
    id;
  return (
    <div className="project-flow-workspace">
      <div className="project-flow-main">
        <div className="canvas-toolbar">
          <div>
            <strong>售前流程</strong>
          </div>
          <button
            className={focused ? "active" : ""}
            onClick={() => setFocused(!focused)}
          >
            <Focus size={14} />
            {focused ? "显示全部环节" : "突出我的环节"}
          </button>
        </div>
        <div className="project-canvas-scroll">
          <div className="project-canvas">
            <svg
              className="project-edges"
              viewBox="0 0 1000 730"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="flow-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7" fill="currentColor" />
                </marker>
                <marker
                  id="change-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7" fill="currentColor" />
                </marker>
              </defs>
              {edges.map((e) => (
                <path
                  key={e.from + e.to}
                  d={e.path}
                  className={`network-edge ${e.condition ? "condition-edge" : ""} ${e.from === selected || e.to === selected ? "related-edge" : ""}`}
                  markerEnd="url(#flow-arrow)"
                />
              ))}
              <rect
                className="parallel-group"
                x="410"
                y="70"
                width="190"
                height="285"
                rx="12"
              />
            </svg>
            <span className="canvas-lane lane-technical">资料与专业协作</span>
            <span className="canvas-lane lane-commercial">报价与投标</span>
            <span className="canvas-lane lane-assessment">风险与测算</span>
            <span className="parallel-label">技术 / 硬件 / 软件 · 并行</span>
            <span className="export-cost-label">出口条件 → 成本</span>
            <span className="export-contract-label">出口结论 → 合同</span>
            {pipelineSteps
              .filter((s) => s.id !== "F14")
              .map((s) => {
                const [x, y] = positions[s.id];
                const latest = entries.find((e) => e.affected.includes(s.id));
                const current = status(s.id);
                const done = ["已写回", "已完成"].includes(current);
                return (
                  <button
                    key={s.id}
                    style={{ left: x / 10 + "%", top: (y / 730) * 100 + "%" }}
                    className={`project-flow-node ${selected === s.id ? "selected" : ""} ${focused && !work.stages.includes(s.id) ? "dimmed" : ""} ${done ? "done" : ""} ${s.id === "F5" ? "software-node" : ""} ${s.id === "F14" ? "change-control-node" : ""}`}
                    onClick={() => {
                      setSelected(s.id);
                      if (window.innerWidth < 1200)
                        requestAnimationFrame(() =>
                          inspector.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                        );
                    }}
                  >
                    <div>
                      <span>{s.id}</span>
                      {done ? <Check size={12} /> : null}
                    </div>
                    <strong>{s.label}</strong>
                    <small>
                      {s.id === "F14" ? "贯穿 F1–F13 · " + s.owner : s.owner}
                    </small>
                    <span className="node-state">
                      {latest &&
                      latest.status !== "已完成" &&
                      latest.status !== "已写回" &&
                      latest.status !== "已关闭"
                        ? "变更待复核"
                        : current}
                    </span>
                    {latest && (
                      <span className="node-change-marker" title={latest.title}>
                        • {latest.version}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      </div>
      <aside className="node-inspector" ref={inspector}>
        <div className="inspector-heading">
          <span>{step.id}</span>
          <Tag tone={status(selected) === "已写回" ? "green" : "amber"}>
            {status(selected)}
          </Tag>
        </div>
        <h2>{step.label}</h2>
        <Link className="btn primary full" to={getRoute(selected)}>
          打开工作区
          <ArrowRight size={14} />
        </Link>
        <NodeAgent
          key={selected}
          stage={selected}
          projectId={referenceProjectId || state.currentProjectId}
        />
        <details className="stage-guide" open>
          <summary>工作步骤</summary>
          <ol>
            {guide?.steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>

          <small>流程依据：{guide?.source}</small>
        </details>
        <div className="inspector-owner">
          <small>{"责任岗位"}</small>
          <p>{step.owner}</p>
        </div>
        <div className="inspector-section">
          <small>{"输入"}</small>
          <p>
            {referenceProjectId
              ? relatedResources.length
                ? relatedResources.map((r) => r.title).join("、")
                : "环节资料待登记。"
              : def?.input ||
                (selected === "F5"
                  ? "技术规格书、能力基线、澄清记录与部署约束。"
                  : "项目资料与工件的新旧版本。")}
          </p>
        </div>
        <div className="inspector-section">
          <small>{"成果"}</small>
          {(
            def?.outputs.map((o) => o.title) ||
            (selected === "F5"
              ? ["客户应答", "澄清表", "研发路径", "服务器规格"]
              : ["差异清单", "受影响工件", "行动与责任人"])
          ).map((t) => (
            <div className="inspector-deliverable" key={t}>
              <strong>{t}</strong>
              <p>
                {def?.outputs.find((o) => o.title === t)?.text ||
                  (t === "客户应答"
                    ? "逐条技术应答、能力依据与偏离说明"
                    : t === "澄清表"
                      ? "问题、责任人、客户答复与关闭记录"
                      : t === "研发路径"
                        ? "复用方案、改造边界与验证条件"
                        : "设备规模、部署约束与规格候选")}
              </p>
            </div>
          ))}
        </div>
        <div className="inspector-section">
          <small>当前事项</small>
          <p>
            {referenceProjectId
              ? relatedIssues.length
                ? relatedIssues.map((i) => i.text).join(" ")
                : "节点完成与审批状态待核实。"
              : selected === "F5"
                ? !state.clarified["Q-01"]
                  ? "视频范围未澄清，相关工件不能写回。"
                  : state.generated
                    ? `${state.rows.filter((r) => r.status === "approved").length}/${state.rows.length} 已复核，继续处理评审队列。`
                    : "资料已就绪，等待执行。"
                : selected === "F14"
                  ? `${Object.values(state.changeStatus).filter((s) => s !== "done").length + Object.values(state.stageStates).filter((s) => s.change && !s.written).length} 项变更待处理。`
                  : data?.response
                    ? "确认依据已记录，继续复核成果。"
                    : def?.question}
          </p>
        </div>
        <div className="inspector-section">
          <small>交接要求</small>
          <p>{guide?.review}</p>
        </div>
        <div className="inspector-section">
          <small>影响与后续</small>
          {entries
            .filter((e) => e.affected.includes(selected))
            .slice(0, 3)
            .map((e) => (
              <Link
                className="inspector-change"
                key={e.id}
                to={
                  "/projects/" +
                  (referenceProjectId || state.currentProjectId) +
                  "?view=changes"
                }
              >
                {e.title}
                <span>{e.version}</span>
              </Link>
            ))}
          {def?.next
            .filter((n) => n !== "F14")
            .map((n) => (
              <Link className="inspector-next" key={n} to={getRoute(n)}>
                {n} {pipelineSteps.find((s) => s.id === n)?.label}
                <ArrowRight size={12} />
              </Link>
            ))}
        </div>
      </aside>
      <ChangeLog
        projectId={referenceProjectId || state.currentProjectId}
        stage={selected}
        compact
      />
    </div>
  );
}
