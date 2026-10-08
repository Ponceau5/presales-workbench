import { Collaboration } from "@/components/Collaboration";
import { stageRowOwner } from "@/lib/accounts";
import { Milestones } from "@/components/Milestones";
import { ChangeLog } from "@/components/ChangeLog";
import { ResourceBrowser } from "@/components/ResourceBrowser";
import {
  ReferenceWorkbench,
  ReferenceFacts,
} from "@/components/ReferenceWorkbench";
import StageWorkbench from "@/pages/StageWorkbench";
import CommercialWorkbench from "@/pages/CommercialWorkbench";
import { roles } from "@/lib/workspace";
import { rackIssues } from "@/lib/portfolio";
import { Link, useParams, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { FileText, ArrowUpRight, X } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { stages } from "@/lib/stages";
import { ProjectFlow } from "@/components/ProjectFlow";
import { Heading, Tag } from "@/components/WorkbenchUI";
export default function Home() {
  const { state, dispatch } = useWorkbench();
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") || "flow";
  const [factsOpen, setFactsOpen] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const reference = state.projects.find((p) => p.id === projectId)?.reference;
  const exists = state.projects.some((p) => p.id === projectId);
  useEffect(() => {
    if (
      exists &&
      projectId &&
      projectId !== state.currentProjectId &&
      !state.running
    )
      dispatch({ type: "projectSwitch", id: projectId });
  }, [
    exists,
    reference,
    projectId,
    state.currentProjectId,
    state.running,
    dispatch,
  ]);
  const project = state.projects.find((p) => p.id === state.currentProjectId)!;
  const stageFacts = Object.entries(state.stageStates).filter(
    ([, s]) => s.written,
  );
  if (!exists)
    return (
      <Heading
        eyebrow="PROJECT"
        title="项目不在当前会话中"
        description="请选择项目，或创建新的项目空间。"
        action={
          <Link className="btn primary" to="/projects">
            查看项目
          </Link>
        }
      />
    );
  if (projectId !== state.currentProjectId)
    return (
      <p className="muted">
        {state.running ? "等待当前运行结束后切换项目。" : "打开项目…"}
      </p>
    );
  return (
    <>
      <header className="project-page-heading">
        <div>
          <h1>{project.name.replace(" · RCJM1", "")}</h1>
          <span>{project.id}</span>
        </div>
        <div className="project-header-actions">
          <button className="btn secondary" onClick={() => setFactsOpen(true)}>
            <FileText size={14} />
            项目事实
          </button>
        </div>
      </header>
      <nav className="project-view-tabs">
        {[
          ["flow", "项目流程"],
          ["materials", "资料与工件"],
          ["collaboration", "协作交接"],
          ["attention", "关注事项"],
          ["milestones", "里程碑"],
          ["changes", "变更日志"],
          ...(view === "review"
            ? [["review", (params.get("stage") || "F5") + " 工作区"]]
            : []),
        ].map(([v, l]) => (
          <button
            key={v}
            className={view === v ? "active" : ""}
            onClick={() => setParams({ view: v })}
          >
            {l}
          </button>
        ))}
      </nav>
      {view === "flow" && (
        <ProjectFlow
          key={state.currentProjectId}
          referenceProjectId={reference ? project.id : undefined}
        />
      )}
      {view === "collaboration" && <Collaboration projectId={project.id} />}
      {view === "materials" && <ResourceBrowser projectId={project.id} />}
      {view === "milestones" && <Milestones reference={reference} />}
      {view === "review" &&
        (params.get("stage") === "F5" ? (
          <ReferenceWorkbench
            key={project.id + state.sourceVersion + (params.get("item") || "")}
            stage="F5"
            projectId={project.id}
          />
        ) : project.id === 'RCJM1' && ['F7','F8','F9'].includes(params.get('stage') || '') ? (
          <CommercialWorkbench key={`${project.id}:${state.role}`} stage={params.get('stage') || 'F7'} projectId={project.id} role={state.role} />
        ) : (
          <>
            <StageWorkbench
              key={project.id + params.get("stage")}
              stageId={params.get("stage") || "F1"}
            />
          </>
        ))}
      {view === "changes" && <ChangeLog projectId={project.id} />}
      {view === "attention" && (
        <section className="issue-register">
          <h2>待处理事项</h2>
          {(reference
            ? rackIssues.map((i) => ({
                id: i.id,
                title: i.title,
                text: i.text,
                owner: i.category,
                stage:
                  i.id === "RC-MARK"
                    ? "F3"
                    : i.id === "RC-NET"
                      ? "F4"
                      : i.id === "RC-DATE"
                        ? "F10"
                        : "F5",
              }))
            : stages
                .filter(
                  (d) =>
                    state.stageStates[d.id]?.generated &&
                    !state.stageStates[d.id]?.written,
                )
                .map((d) => ({
                  id: d.id,
                  title: d.title,
                  text: d.question,
                  owner: d.owner,
                  stage: d.id,
                }))
          ).map((i) => (
            <div className="issue-register-row" key={i.id}>
              <span>
                <strong>{i.title}</strong>
                <p>{i.text}</p>
              </span>
              <span>
                {state.followups.find(
                  (f) => f.projectId === project.id && f.title === i.title,
                )?.owner || i.owner}
              </span>
              <div className="issue-actions">
                <Link
                  to={
                    "/projects/" + project.id + "?view=review&stage=" + i.stage
                  }
                >
                  查看
                </Link>
                {state.role === "PM / PO" && (
                  <select
                    aria-label={"分派 " + i.title}
                    value={
                      assignments[i.id] ||
                      (state.role === "PM / PO"
                        ? stageRowOwner(i.stage, 0)
                        : state.role)
                    }
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
                    (f) => f.projectId === project.id && f.title === i.title,
                  )}
                  onClick={() =>
                    dispatch({
                      type: "followup",
                      projectId: project.id,
                      title: i.title,
                      owner:
                        assignments[i.id] ||
                        (state.role === "PM / PO"
                          ? stageRowOwner(i.stage, 0)
                          : state.role),
                    })
                  }
                >
                  {state.followups.some(
                    (f) => f.projectId === project.id && f.title === i.title,
                  )
                    ? "已加入待办"
                    : state.role === "PM / PO"
                      ? "分派"
                      : "加入待办"}
                </button>
              </div>
            </div>
          ))}
          {state.followups
            .filter(
              (f) =>
                f.projectId === project.id &&
                !(reference
                  ? rackIssues.some((i) => i.title === f.title)
                  : stages.some((i) => i.title === f.title)),
            )
            .map((f) => (
              <div className="issue-register-row" key={f.id}>
                <span>
                  <strong>{f.title}</strong>
                  {f.result && <small>{f.result}</small>}
                  {f.url && <Link to={f.url}>关联工件</Link>}
                </span>
                <span>{f.owner}</span>
                <span>{f.status === "done" ? "已处理" : "待跟进"}</span>
              </div>
            ))}
        </section>
      )}
      {factsOpen ? (
        <div className="facts-overlay">
          <button
            className="overlay-scrim"
            aria-label="关闭项目事实"
            onClick={() => setFactsOpen(false)}
          />
          <aside className="facts-drawer">
            <div>
              <h2>项目事实</h2>
              <button
                aria-label="关闭事实面板"
                onClick={() => setFactsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="facts-view">
              <ReferenceFacts projectId={project.id} />
              {stageFacts.map(([id, s]) =>
                s.rows.map((r, i) => (
                  <details key={id + i}>
                    <summary>
                      <span>
                        {id} · {r.title}
                      </span>
                      <Tag tone="green">V{s.version}</Tag>
                    </summary>
                    <p>{r.text}</p>
                    <small>
                      {r.evidence} · {stages.find((d) => d.id === id)?.owner}
                    </small>
                  </details>
                )),
              )}
            </div>
            <Link
              className="text-link"
              to={"/projects/" + project.id + "?view=changes"}
              onClick={() => setFactsOpen(false)}
            >
              查看版本影响
              <ArrowUpRight size={13} />
            </Link>
          </aside>
        </div>
      ) : null}
    </>
  );
}
