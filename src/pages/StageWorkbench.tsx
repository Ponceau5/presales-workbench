import { StageHandoffs } from "@/components/Collaboration";
import { canPublishStage } from "@/lib/workflowEngine";
import { stageArtifact } from "@/lib/agentTasks";
import { NodeAgent } from "@/components/NodeAgent";
import { StageEvidence } from "@/components/StageEvidence";
import { FullTextDiff } from "@/components/FullTextDiff";
import {
  stagePermission,
  canReviewStage,
  canEditStageRow,
  stageRowOwner,
} from "@/lib/accounts";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Check,
  Pencil,
  X,
  ArrowRight,
  GitCompareArrows,
  Save,
  UserRound,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StageTools } from "@/components/StageTools";
import { FlowCanvas } from "@/components/FlowCanvas";
import { stagesForProject } from "@/lib/projectStages";

import { useWorkbench, type StageAction } from "@/state/workbench";
import {
  Heading,
  Section,
  Tag,
  Status,
  Source,
} from "@/components/WorkbenchUI";
export default function StageWorkbench({ stageId }: { stageId?: string } = {}) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const id = stageId || params.id || "F1";
  const { state, dispatch } = useWorkbench();
  const stages = stagesForProject(state.currentProjectId);
  const def = stages.find((s) => s.id === id);
  const actor = state.accountId + " · " + state.role;
  const canEdit = stagePermission(state.role, id);
  const canReview = canReviewStage(state.role, id);
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState<{
    kind: "edit" | "reject" | "respond" | "write";
    index?: number;
  } | null>(null);
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("");
  const [ack, setAck] = useState(false);
  const [view, setView] = useState("资料");
  const [targetIndex, setTargetIndex] = useState(() => {
    const requested = Number(searchParams.get("row"));
    return searchParams.has("row") && requested >= 0 && requested < 2
      ? requested
      : Math.max(
          0,
          [0, 1].findIndex((n) => stageRowOwner(id, n) === state.role),
        );
  });
  if (!def)
    return (
      <Heading
        eyebrow="PROJECT"
        title="未找到环节"
        description="请从项目总览选择售前环节。"
      />
    );
  const stored = state.stageStates[id];
  const data = stored.generated
    ? stored
    : {
        ...stored,
        rows: def.outputs.map((o) => ({ ...o, status: "pending" as const })),
      };
  const upstream = stages.filter(
    (s) => s.next.includes(id) && state.stageStates[s.id].written,
  );
  const act = (kind: StageAction["kind"], extra: Partial<StageAction> = {}) =>
    dispatch({ type: "stage", id, kind, actor, note, ...extra });
  const ready = canPublishStage(
    stored,
    state.deliveries,
    state.currentProjectId,
    id,
  );
  function open(kind: "edit" | "reject" | "respond" | "write", index?: number) {
    setDialog({ kind, index });
    setText(kind === "edit" ? data.rows[index || 0].text : "");
    setEvidence("");
    setAck(false);
  }
  return (
    <>
      <Heading eyebrow={id} description="" title={def.title} />
      <StageHandoffs projectId={state.currentProjectId} stage={id} />
      <details className="work-process-disclosure" open>
        <summary>处理流程</summary>
        <FlowCanvas
          id={id}
          onSelect={(index) => setView(["资料", "成果", "核对", "记录"][index])}
        />
      </details>

      <div className="stage-workspace">
        <div className="stage-review-document">
          <nav className="document-tabs" aria-label="工作区视图">
            {["资料", "成果", "核对", "版本", "记录"].map((item) => (
              <button
                key={item}
                className={view === item ? "active" : ""}
                onClick={() => setView(item)}
              >
                {item}
              </button>
            ))}
          </nav>
          {view === "资料" && (
            <StageEvidence id={id} projectId={state.currentProjectId} />
          )}
          {view === "资料" && (
            <Section title="资料与依据">
              <div className="stage-body">
                <p>{def.input}</p>
                {upstream.length ? (
                  <div className="upstream-facts">
                    <strong>复用上游已确认事实</strong>
                    {upstream.map((s) => (
                      <Link
                        key={s.id}
                        to={
                          "/projects/" +
                          state.currentProjectId +
                          "?view=review&stage=" +
                          s.id
                        }
                      >
                        <span>
                          {s.id} · V{state.stageStates[s.id].version}
                        </span>
                        <p>
                          {state.stageStates[s.id].rows
                            .map((r) => r.text)
                            .join("；")}
                        </p>
                      </Link>
                    ))}
                  </div>
                ) : null}
                <Source>{def.source}</Source>
                {id === "F3" && state.currentProjectId !== "RCJM1" && (
                  <StageTools id="F3" />
                )}
              </div>
            </Section>
          )}
          {view === "核对" && (
            <section className="stage-verification">
              <header>
                <h3>输入与结果核对</h3>
                <select
                  aria-label="选择核对工件"
                  value={targetIndex}
                  onChange={(e) => setTargetIndex(Number(e.target.value))}
                >
                  {data.rows.map((r, i) => (
                    <option key={r.title} value={i}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </header>
              <div>
                <section>
                  <h4>输入资料</h4>
                  <p>{def.input}</p>
                  <StageEvidence id={id} projectId={state.currentProjectId} />
                </section>
                <section>
                  <h4>
                    {data.generated
                      ? data.rows[targetIndex].title
                      : "尚无处理结果"}
                  </h4>
                  <Source>
                    {data.rows[targetIndex].evidence} · V{data.version}
                  </Source>
                  {data.generated && <p>{data.rows[targetIndex].text}</p>}
                  <label className="form-label">
                    核对记录
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="记录原文位置、处理差异及修正依据"
                      readOnly={!canEditStageRow(state.role, id, targetIndex)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="btn secondary"
                      disabled={
                        !data.generated ||
                        !canEditStageRow(state.role, id, targetIndex)
                      }
                      onClick={() => open("edit", targetIndex)}
                    >
                      修正结果
                    </button>
                    <button
                      className="btn primary"
                      disabled={
                        !data.generated ||
                        !note.trim() ||
                        !canEditStageRow(state.role, id, targetIndex) ||
                        data.rows[targetIndex].status === "approved"
                      }
                      onClick={() => act("approve", { index: targetIndex })}
                    >
                      核对并批准
                    </button>
                  </div>
                  {!data.generated && <p>尚未执行处理，请先生成候选结果。</p>}
                </section>
              </div>
            </section>
          )}
          {view === "成果" && (
            <Section
              title="成果评审"
              extra={
                <Tag>
                  {data.rows.filter((r) => r.status === "approved").length}/
                  {data.rows.length} 已批准
                </Tag>
              }
            >
              {canReview && (
                <div className="reviewer-bar">
                  <label>
                    操作人
                    <input value={actor} readOnly />
                  </label>
                  <label className="review-note">
                    复核意见
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="填写依据与专业判断"
                    />
                  </label>
                </div>
              )}
              {data.rows.map((row, index) => (
                <article className="review-row" key={row.title}>
                  <div className="row-heading">
                    <h3>{row.title}</h3>
                    <Status value={row.status} />
                  </div>
                  <ul className="stage-output-lines">
                    {row.text
                      .split(/[；。](?!\d)/)
                      .filter(Boolean)
                      .map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                  </ul>
                  <button className="btn mini" onClick={() => setView("资料")}>
                    对照输入资料
                  </button>
                  <Source>
                    {row.evidence} · 工件 V{data.version}
                  </Source>
                  <div className="row-meta">
                    <span>责任：{stageRowOwner(id, index)}</span>
                    <span></span>
                  </div>
                  {canEditStageRow(state.role, id, index) && (
                    <div className="row-actions">
                      <button
                        className="btn mini approve"
                        disabled={
                          !canEditStageRow(state.role, id, index) ||
                          !data.generated ||
                          !note.trim() ||
                          !actor.trim() ||
                          row.status === "approved"
                        }
                        onClick={() => act("approve", { index })}
                      >
                        <Check size={13} />
                        批准记录
                      </button>
                      <button
                        className="btn mini"
                        disabled={
                          !canEditStageRow(state.role, id, index) ||
                          !data.generated
                        }
                        onClick={() => open("edit", index)}
                      >
                        <Pencil size={13} />
                        修改
                      </button>
                      <button
                        className="btn mini reject"
                        disabled={
                          !canEditStageRow(state.role, id, index) ||
                          !data.generated
                        }
                        onClick={() => open("reject", index)}
                      >
                        <X size={13} />
                        驳回
                      </button>
                      {row.status === "rejected" ? (
                        <button
                          className="btn mini"
                          disabled={!canEdit}
                          onClick={() => act("generate")}
                        >
                          <RotateCcw size={13} />
                          重生成初稿
                        </button>
                      ) : null}
                    </div>
                  )}
                </article>
              ))}
              <div className="write-bar">
                <div>
                  <strong>项目事实</strong>
                  <small>
                    {data.written
                      ? "已写回当前版本"
                      : ready
                        ? "待写回"
                        : "待完成确认与复核"}
                  </small>
                </div>
                {canReview && (
                  <button
                    className="btn primary"
                    disabled={
                      !canReview || !ready || data.written || !actor.trim()
                    }
                    onClick={() => open("write")}
                  >
                    <Save size={15} />
                    写回项目事实
                  </button>
                )}
              </div>
            </Section>
          )}
          {view === "资料" && (
            <StageEvidence id={id} projectId={state.currentProjectId} />
          )}
          {view === "版本" && (
            <Section title="版本变化" extra={<Tag>V1 → V2</Tag>}>
              <div className="stage-body">
                <FullTextDiff
                  before={def.outputs
                    .map((o) => o.title + "\n" + o.text)
                    .join("\n\n")}
                  after={def.outputs
                    .map(
                      (o, i) =>
                        o.title + "\n" + (i === 0 ? def.changedText : o.text),
                    )
                    .join("\n\n")}
                />
                <div className="actions">
                  <button
                    className="btn secondary"
                    disabled={!canEdit || !data.generated || data.change}
                    onClick={() => act("change")}
                  >
                    <GitCompareArrows size={15} />
                    应用 V2 并创建受影响评审
                  </button>
                  <button
                    className="btn secondary"
                    disabled={
                      (!canEdit && state.role !== "PM / PO") ||
                      !data.change ||
                      data.assigned
                    }
                    onClick={() => act("assign")}
                  >
                    <UserRound size={15} />
                    {data.assigned ? "已派发处理" : "派发给 " + def.owner}
                  </button>
                </div>
                {data.change ? (
                  <div className="stage-impact">
                    <Tag tone={data.written ? "green" : "amber"}>
                      {data.written
                        ? "受影响条目已重审写回"
                        : data.assigned
                          ? "已派发 · 待重审"
                          : "已创建受影响评审"}
                    </Tag>
                    <p>
                      影响后续：{def.next.join(" / ")}。处理人：{def.owner}。
                    </p>
                  </div>
                ) : null}
              </div>
            </Section>
          )}
          {view === "记录" && (
            <Section title="评审记录">
              <div className="activity-list">
                {state.audit
                  .filter(
                    (a) => a.target.startsWith(id + ":") || a.target === id,
                  )
                  .slice(0, 8)
                  .map((a) => (
                    <div key={a.id}>
                      <span className="dot" />
                      <p>
                        <strong>
                          {a.action} · {a.actor}
                        </strong>
                        <small>
                          {new Date(a.at).toLocaleTimeString()} · V{a.version} ·{" "}
                          {a.note}
                        </small>
                      </p>
                    </div>
                  ))}
              </div>
            </Section>
          )}
        </div>
        <div className="stage-agent-column">
          <select
            aria-label="Agent处理工件"
            value={targetIndex}
            onChange={(e) => setTargetIndex(Number(e.target.value))}
          >
            {data.rows.map((r, i) => (
              <option key={i} value={i}>
                {r.title} · {stageRowOwner(id, i)}
              </option>
            ))}
          </select>
          <NodeAgent
            key={state.currentProjectId + id + targetIndex + state.accountId}
            stage={id}
            projectId={state.currentProjectId}
            artifact={stageArtifact(
              state.currentProjectId,
              id,
              targetIndex,
              data.rows[targetIndex].text,
              data.version,
              data.response?.text,
            )}
            onSource={() => setView("资料")}
            onGenerate={
              canEdit && !data.generated
                ? () => {
                    act("generate");
                    setView("核对");
                  }
                : undefined
            }
            onApply={
              data.generated && canEditStageRow(state.role, id, targetIndex)
                ? (value) => {
                    open("edit", targetIndex);
                    setText(value);
                  }
                : undefined
            }
          />
          <aside className="stage-review-sidebar compact-review-side">
            <header>
              <h2>确认与交接</h2>
              <Tag tone={data.response ? "green" : "amber"}>
                {data.response ? "已答复" : "待确认"}
              </Tag>
            </header>
            <section>
              <h3>确认事项</h3>
              <p>{def.question}</p>
              {data.response && (
                <div className="answer-record">
                  <p>{data.response.text}</p>
                  <Source>{data.response.evidence}</Source>
                </div>
              )}
              {canEdit && (
                <button
                  className="btn secondary"
                  disabled={!data.generated}
                  onClick={() => open("respond")}
                >
                  录入确认与依据
                </button>
              )}
            </section>
            <section>
              <h3>复核责任</h3>
              {data.rows.map((r, i) => (
                <div className="handoff-row" key={r.title}>
                  <span>{r.title}</span>
                  <small>{stageRowOwner(id, i)}</small>
                  <Status value={r.status} />
                </div>
              ))}
            </section>
            <section>
              <h3>交付标准</h3>
              <p>{def.goal}</p>
              <Source>{def.source}</Source>
            </section>
            <section>
              <h3>下游交接</h3>
              {def.next
                .filter((n) => n !== "F14")
                .map((next) => (
                  <Link
                    className="next-stage"
                    key={next}
                    to={
                      "/projects/" +
                      state.currentProjectId +
                      "?view=review&stage=" +
                      next
                    }
                  >
                    {next} ·{" "}
                    {stages.find((s) => s.id === next)?.title ||
                      (next === "F5" ? "软件技术支持" : "")}
                    <ArrowRight size={13} />
                  </Link>
                ))}
            </section>
          </aside>
        </div>
      </div>
      <Dialog
        open={!!dialog}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {
                {
                  edit: "修改成果初稿",
                  reject: "驳回初稿",
                  respond: "记录确认与依据",
                  write: "写回项目事实",
                }[dialog?.kind || "edit"]
              }
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "write"
                ? "仅写回已复核的演示记录，不构成正式报价、合同、出口或技术结论。"
                : "保存操作人、时间、版本与意见；答复或修改后需要重新批准。"}
            </DialogDescription>
          </DialogHeader>
          {dialog?.kind === "write" ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              我确认依据、缺项及专业边界已逐项复核。
            </label>
          ) : (
            <label className="form-label">
              {dialog?.kind === "reject" ? "驳回原因" : "内容"}
              <textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          {dialog?.kind === "edit" && (
            <label className="form-label">
              修改说明
              <textarea
                aria-label="修改说明"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          {dialog?.kind === "respond" ? (
            <label className="form-label">
              来源 / 版本 / 提供人
              <input
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
          ) : null}
          <button
            className="btn primary"
            disabled={
              !canEdit ||
              !actor.trim() ||
              (dialog?.kind === "write" ? !ack : !text.trim()) ||
              (dialog?.kind === "respond" && !evidence.trim()) ||
              (dialog?.kind === "edit" && !note.trim())
            }
            onClick={() => {
              if (dialog)
                act(dialog.kind, {
                  index: dialog.index,
                  text,
                  evidence,
                  note: dialog.kind === "reject" ? text : note,
                });
              setDialog(null);
            }}
          >
            保存记录
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
