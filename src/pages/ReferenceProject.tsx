import { roles } from "@/lib/workspace";
import { useState } from "react";
import {
  ReferenceWorkbench,
  ReferenceFacts,
} from "@/components/ReferenceWorkbench";
import { Milestones } from "@/components/Milestones";
import { ChangeLog } from "@/components/ChangeLog";
import { ProjectFlow } from "@/components/ProjectFlow";
import { pipelineSteps } from "@/lib/presales";
import { rackStageResources } from "@/lib/portfolio";
import { useSearchParams } from "react-router";
import { FileText, ArrowUpRight } from "lucide-react";
import { rackProject, rackIssues, fileHref } from "@/lib/portfolio";
import { ResourceBrowser } from "@/components/ResourceBrowser";
import { useWorkbench } from "@/state/workbench";
export default function ReferenceProject() {
  const [params, setParams] = useSearchParams();
  const [factsOpen, setFactsOpen] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const view =
    params.get("view") || (params.has("issue") ? "attention" : "flow");
  const stage = pipelineSteps.find((s) => s.id === params.get("stage"));
  const { state, dispatch } = useWorkbench();
  return (
    <div className="reference-project-page">
      <header className="project-page-heading">
        <div>
          <h1>Racks Central</h1>
          <span>RCJM1 · 马来西亚</span>
        </div>
        <div className="project-header-actions">
          <span className="project-phase-badge">执行交付</span>
          <button
            className="btn secondary"
            onClick={() => setFactsOpen(!factsOpen)}
          >
            项目事实
          </button>
          <a className="btn secondary" href={fileHref(rackProject.notePath)}>
            <FileText size={14} />
            项目档案
            <ArrowUpRight size={13} />
          </a>
        </div>
      </header>
      {factsOpen && <ReferenceFacts />}
      <nav className="project-view-tabs" aria-label="项目视图">
        {[
          ["flow", "项目流程"],
          ["materials", "资料与工件"],
          ["attention", "关注事项"],
          ["milestones", "里程碑"],
          ["changes", "变更日志"],
          ...(view === "review" ? [["review", stage?.id + " 工作区"]] : []),
        ].map(([value, label]) => (
          <button
            key={value}
            className={view === value ? "active" : ""}
            onClick={() => setParams({ view: value })}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === "flow" && (
        <ProjectFlow
          key={params.get("stage") || "flow"}
          referenceProjectId="RCJM1"
        />
      )}
      {view === "review" && <ReferenceWorkbench stage={stage?.id || "F5"} />}
      {view === "materials" && (
        <ResourceBrowser
          key={stage?.id || "all"}
          projectId="RCJM1"
          resourceIds={stage ? rackStageResources[stage.id] : undefined}
        />
      )}
      {view === "milestones" && <Milestones reference />}
      {view === "changes" && <ChangeLog projectId="RCJM1" />}
      {view === "attention" && (
        <section className="issue-register">
          <header>
            <h2>关注事项</h2>
            <span>项目记录 · 2026.09.15</span>
          </header>
          <div className="issue-register-head">
            <span>事项 / 内容</span>
            <span>分类</span>
            <span>状态</span>
          </div>
          {rackIssues.map((i) => (
            <div className="issue-register-row" key={i.id}>
              <span>
                <strong>{i.title}</strong>
                <p>{i.text}</p>
              </span>
              <span>{i.category}</span>
              <span className="status-pending">
                待核实{" "}
                {state.role === "PM / PO" && (
                  <select
                    aria-label={"责任岗位 " + i.title}
                    value={assignments[i.id] || state.role}
                    onChange={(e) =>
                      setAssignments({ ...assignments, [i.id]: e.target.value })
                    }
                  >
                    {roles.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                )}
                <button
                  className="text-link"
                  disabled={state.followups.some(
                    (f) => f.projectId === "RCJM1" && f.title === i.title,
                  )}
                  onClick={() =>
                    dispatch({
                      type: "followup",
                      projectId: "RCJM1",
                      title: i.title,
                      owner: assignments[i.id] || state.role,
                    })
                  }
                >
                  {state.followups.some(
                    (f) => f.projectId === "RCJM1" && f.title === i.title,
                  )
                    ? "已加入跟进"
                    : "加入跟进"}
                </button>
              </span>
            </div>
          ))}
          {state.followups
            .filter((f) => f.projectId === "RCJM1")
            .map((f) => (
              <div className="issue-register-row" key={f.id}>
                <span>
                  <strong>{f.title}</strong>
                  <small>{f.source}</small>
                </span>
                <span>{f.owner}</span>
                <span>待跟进</span>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
