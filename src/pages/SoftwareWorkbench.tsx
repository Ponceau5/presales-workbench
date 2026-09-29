import { canPublishSoftware } from "@/lib/accounts";
import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  Play,
  ArrowRight,
  Check,
  Pencil,
  RotateCcw,
  X,
  ShieldCheck,
  FileText,
  ChevronRight,
  AlertTriangle,
  Save,
  LoaderCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FlowCanvas } from "@/components/FlowCanvas";
import {
  changes,
  artifactMeta,
  requirements,
  type Artifact,
} from "@/lib/presales";
import {
  useWorkbench,
  blocked,
  canWrite,
  type ReviewedRow,
} from "@/state/workbench";
import {
  Heading,
  Section,
  Tag,
  Risk,
  Status,
  Source,
} from "@/components/WorkbenchUI";
export default function SoftwareWorkbench() {
  const { state, dispatch, runAgent } = useWorkbench();
  const [params, setParams] = useSearchParams();
  const artifact = (
    ["customer", "clarification", "dev", "server"].includes(
      params.get("artifact") || "",
    )
      ? params.get("artifact")
      : state.role === "研发"
        ? "dev"
        : state.role === "解决方案"
          ? "server"
          : "customer"
  ) as Artifact;
  const [selected, setSelected] = useState(params.get("req") || "REQ-04");
  const [riskOnly, setRiskOnly] = useState(false);
  const [owner, setOwner] = useState("全部岗位");
  const actor = state.accountId + " · " + state.role;
  const canRun = ["软件产品", "研发", "解决方案"].includes(state.role);
  const [note, setNote] = useState("");
  const [modal, setModal] = useState<{
    row: ReviewedRow;
    action: "edit" | "reject" | "respond";
  } | null>(null);
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("");
  const [notice, setNotice] = useState("");
  const [writeOpen, setWriteOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const visible = state.rows.filter(
    (r) =>
      r.artifact === artifact &&
      (!riskOnly || r.risk === "high") &&
      (owner === "全部岗位" || r.owner === owner),
  );
  const selectedReq =
    requirements.find((r) => r.id === selected) || requirements[3];
  const selectedRows = state.rows.filter((r) => r.req === selected);
  const approved = state.rows.filter((r) => r.status === "approved").length;
  const rejected = state.rows.filter((r) => r.status === "rejected" && r.owner === state.role);
  const ready = canWrite(state);
  const alreadyWritten =
    state.facts.length > 0 &&
    state.rows
      .filter((r) => r.artifact !== "server")
      .every((r) =>
        state.facts.some((f) => f.id === r.id && f.revision === r.revision),
      );
  function open(row: ReviewedRow, action: "edit" | "reject" | "respond") {
    setModal({ row, action });
    setText(action === "edit" ? row.text : "");
    setEvidence("");
  }
  function submit() {
    if (!modal) return;
    if (modal.action === "respond") {
      dispatch({ type: "respond", id: modal.row.id, text, evidence, actor });
      setNotice("答复与来源已记录；关联工件重新进入评审。");
    } else {
      dispatch({
        type: "review",
        id: modal.row.id,
        action: modal.action,
        text,
        note: modal.action === "reject" ? text : note,
        actor,
      });
      setNotice(
        modal.action === "reject"
          ? "已驳回。请按评审意见重新生成此条。"
          : "修改已留痕，请重新批准。",
      );
    }
    setModal(null);
  }
  function approve(row: ReviewedRow) {
    dispatch({ type: "review", id: row.id, action: "approve", note, actor });
    setNotice(`${row.id} 已批准，保留当前版本与复核意见。`);
  }
  return (
    <>
      <Heading
        eyebrow="F5 · F3S / SOFTWARE REVIEW"
        title="软件应答工作台"
        description="要求、应答与依据"
        action={
          <div className="actions">
            <button
              className="btn secondary"
              disabled={!canRun || state.running || !rejected.length}
              onClick={() => runAgent(rejected.map((r) => r.id))}
            >
              <RotateCcw size={15} />
              重生成驳回项
            </button>
            <button
              className="btn primary"
              disabled={!canRun || state.running || state.generated}
              onClick={() => runAgent()}
            >
              {state.running ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}{" "}
              {state.running
                ? "Agent 执行中"
                : state.generated
                  ? "初稿已生成"
                  : "运行 Agent"}
            </button>
          </div>
        }
      />
      <div className="review-context">
        <span>
          <FileText size={15} />
          技术规格书 V{state.sourceVersion}
        </span>
        <span>能力基线 V1</span>
        <span>运行 #{state.run}</span>
        <Tag tone="amber">客户侧待审</Tag>
      </div>
      <FlowCanvas id="F5" />
      {state.running ? (
        <div className="running-message" role="status">
          {state.events.at(-1)}
        </div>
      ) : null}
      <div className="review-layout">
        <aside className="requirement-pane">
          <div className="pane-title">
            <h2>规格要求</h2>
            <Tag>6 条</Tag>
          </div>
          <div className="requirement-list">
            {requirements.map((r) => (
              <button
                key={r.id}
                className={`requirement-item ${r.id === selected ? "selected" : ""}`}
                onClick={() => setSelected(r.id)}
              >
                <div>
                  <span className="mono">{r.id}</span>
                  <span className={`risk-dot ${r.risk}`} />
                </div>
                <strong>{r.title}</strong>
                <small>
                  {r.category} · {r.section.split(" · ")[0]}
                </small>
              </button>
            ))}
          </div>
          <div className="requirement-help">
            <ShieldCheck size={17} />
            <p></p>
          </div>
        </aside>
        <div className="artifact-pane">
          <div className="artifact-tabs" role="tablist" aria-label="输出工件">
            {(Object.keys(artifactMeta) as Artifact[]).map((a) => (
              <button
                key={a}
                role="tab"
                aria-selected={artifact === a}
                className={artifact === a ? "selected" : ""}
                onClick={() => setParams({ artifact: a })}
              >
                {artifactMeta[a].label}
                <span>
                  {
                    state.rows.filter(
                      (r) => r.artifact === a && r.status === "approved",
                    ).length
                  }
                  /{state.rows.filter((r) => r.artifact === a).length}
                </span>
              </button>
            ))}
          </div>
          <div className="artifact-heading">
            <div>
              <h2>{artifactMeta[artifact].label}</h2>
              <p>{artifactMeta[artifact].audience}</p>
            </div>
            <Tag>{artifactMeta[artifact].owner}</Tag>
          </div>
          <div className="reviewer-bar">
            <label>
              操作人
              <input value={actor} readOnly aria-label="评审操作人" />
            </label>
            <label className="review-note">
              复核意见
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="批准 / 修改前填写专业复核依据"
                aria-label="复核意见"
              />
            </label>
          </div>
          <div className="filter-bar">
            <label>
              <input
                type="checkbox"
                checked={riskOnly}
                onChange={(e) => setRiskOnly(e.target.checked)}
              />
              只看高风险
            </label>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="按责任岗位过滤"
            >
              {["全部岗位", "软件产品", "研发", "解决方案"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <small>
              {visible.length} 条 · 批准 {approved}/{state.rows.length}
            </small>
          </div>
          {!state.generated ? (
            <div className="preview-note">
              <Play size={14} />
              运行后开始评审。
            </div>
          ) : null}
          <div className="review-rows">
            {visible.map((row) => (
              <article
                className={`review-row ${row.req === selected ? "focused" : ""}`}
                key={row.id}
              >
                <div className="row-heading">
                  <button
                    className="row-select"
                    onClick={() => setSelected(row.req)}
                  >
                    <span className="mono">{row.id}</span>
                    <h3>{row.title}</h3>
                  </button>
                  <Status value={row.status} />
                </div>
                <p className="row-content">{row.text}</p>
                {row.blocker === "video" && !state.clarified["Q-01"] ? (
                  <div className="inline-warning">
                    <AlertTriangle size={14} />
                    未澄清视频范围。客户应答、研发路径与容量不能批准写回。
                  </div>
                ) : null}
                {row.artifact === "clarification" && state.clarified[row.id] ? (
                  <div className="answer-record">
                    <strong>人工答复</strong>
                    <p>{state.clarified[row.id].text}</p>
                    <Source>{state.clarified[row.id].evidence}</Source>
                  </div>
                ) : null}
                <button
                  className="evidence-button"
                  onClick={() => setSelected(row.req)}
                >
                  <FileText size={13} />
                  {row.req} · 来源与能力依据
                  <ArrowRight size={12} />
                </button>
                <div className="row-meta">
                  <span>
                    规格书 V{row.version} · 工件 r{row.revision}
                  </span>
                  <span>责任：{row.owner}</span>
                  <Risk risk={row.risk} />
                </div>
                {row.artifact === "server" ? (
                  <div className="model-confirm">
                    <label>
                      <input
                        type="checkbox"
                        checked={state.modelConfirmed}
                        disabled={
                          state.role !== "解决方案" ||
                          state.modelConfirmed ||
                          !state.generated ||
                          !state.clarified["Q-01"] ||
                          !actor.trim() ||
                          state.running
                        }
                        onChange={() => dispatch({ type: "model", actor })}
                      />
                      我已核对演示假设；此计算不作为有效服务器规格事实
                    </label>
                  </div>
                ) : null}
                <div className="row-actions">
                  <button
                    className="btn mini approve"
                    onClick={() => approve(row)}
                    disabled={
                      row.owner !== state.role ||
                      !state.generated ||
                      state.running ||
                      blocked(row, state) ||
                      row.status === "approved" ||
                      !actor.trim() ||
                      !note.trim()
                    }
                  >
                    <Check size={13} />
                    批准
                  </button>
                  <button
                    className="btn mini"
                    disabled={
                      row.owner !== state.role ||
                      !state.generated ||
                      state.running
                    }
                    onClick={() => open(row, "edit")}
                  >
                    <Pencil size={13} />
                    修改
                  </button>
                  <button
                    className="btn mini reject"
                    disabled={
                      row.owner !== state.role ||
                      !state.generated ||
                      state.running
                    }
                    onClick={() => open(row, "reject")}
                  >
                    <X size={13} />
                    驳回
                  </button>
                  {row.artifact === "clarification" ? (
                    <button
                      className="btn mini"
                      disabled={
                        row.owner !== state.role ||
                        !state.generated ||
                        state.running
                      }
                      onClick={() => open(row, "respond")}
                    >
                      录入答复
                    </button>
                  ) : null}
                  {row.status === "rejected" ? (
                    <button
                      className="btn mini"
                      disabled={row.owner !== state.role || state.running}
                      onClick={() => runAgent([row.id])}
                    >
                      <RotateCcw size={13} />
                      重生成此条
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {!visible.length ? (
              <div className="empty-state">
                没有符合筛选条件的条目。调整风险或责任岗位筛选。
              </div>
            ) : null}
          </div>
          <div className="write-bar">
            <div>
              <strong>
                {alreadyWritten
                  ? "已写回当前演示事实"
                  : ready
                    ? "复核完成，可以写回"
                    : "必要确认完成后，才能写回"}
              </strong>
              <small>
                {approved}/{state.rows.length} 已批准 · 澄清答复{" "}
                {Object.keys(state.clarified).length}/2 · 服务器仅保留评审记录
              </small>
            </div>
            <button
              className="btn primary"
              disabled={
                !canPublishSoftware(state.role) || !ready || alreadyWritten
              }
              onClick={() => {
                setWriteOpen(true);
                setAck(false);
              }}
            >
              <Save size={15} />
              写回项目事实
            </button>
          </div>
          {notice ? (
            <div role="status" className="notice">
              {notice}
            </div>
          ) : null}
        </div>
        <aside className="evidence-pane">
          <div className="pane-title">
            <h2>依据与影响</h2>
            <FileText size={16} />
          </div>
          <div className="evidence-content">
            <span className="mono">{selectedReq.id}</span>
            <h3>{selectedReq.title}</h3>
            <Risk risk={selectedReq.risk} />
            <div className="evidence-block">
              <small>来源原文</small>
              <blockquote>
                {changes.find(
                  (c) =>
                    c.reqs.includes(selectedReq.id) &&
                    ["reviewing", "done"].includes(state.changeStatus[c.id]),
                )?.after || selectedReq.sourceText}
              </blockquote>
              <Source>
                技术规格书 V{state.sourceVersion} · {selectedReq.section}
              </Source>
            </div>
            <div className="evidence-block">
              <small>能力匹配依据</small>
              <p>{selectedReq.capability}</p>
            </div>
            <div className="evidence-block">
              <small>受影响工件</small>
              {selectedRows.map((r) => (
                <button
                  className="impact-link"
                  key={r.id}
                  onClick={() => setParams({ artifact: r.artifact })}
                >
                  <span>
                    {r.id} · {artifactMeta[r.artifact].label}
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
            <div className="evidence-block">
              <small>关联澄清</small>
              <p>
                {selectedReq.id === "REQ-04"
                  ? state.clarified["Q-01"]?.text ||
                    "Q-01 未答复。软件产品经顾问 / 客户确认范围。"
                  : selectedReq.id === "REQ-06"
                    ? state.clarified["Q-02"]?.text ||
                      "Q-02 未答复。客户 IT / 顾问提供部署输入。"
                    : "无关联澄清；依据仍需责任人复核。"}
              </p>
            </div>
            <div className="evidence-block">
              <small>评审记录</small>
              {state.audit
                .filter(
                  (a) =>
                    selectedRows.some((r) => r.id === a.target) ||
                    a.target === "项目事实",
                )
                .slice(0, 6)
                .map((a) => (
                  <div className="audit-entry" key={a.id}>
                    <strong>
                      {a.action} · {a.target}
                    </strong>
                    <p>
                      {a.actor} · {new Date(a.at).toLocaleTimeString()}
                    </p>
                    <p>{a.note}</p>
                  </div>
                ))}
              {!state.audit.length ? (
                <p>批准、修改、驳回、答复均记录操作人、时间、意见与版本。</p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
      <Section title="执行记录" extra={<Tag>执行日志</Tag>}>
        <div className="event-log">
          {state.events.length ? (
            state.events.map((event, i) => (
              <span key={i}>
                <Check size={13} />
                {event}
              </span>
            ))
          ) : (
            <span className="muted">
              等待首次执行。Live 模式仅验证连接，业务闭环仍为本地 Mock 回放。
            </span>
          )}
        </div>
      </Section>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modal?.action === "respond"
                ? "记录澄清答复"
                : modal?.action === "edit"
                  ? "修改工件初稿"
                  : "驳回并说明原因"}{" "}
              · {modal?.row.id}
            </DialogTitle>
            <DialogDescription>
              {modal?.action === "respond"
                ? "答复须有来源。提交后关联应答与计算重新待审。"
                : modal?.action === "edit"
                  ? "修改会记录前后内容，并撤销当前批准状态。"
                  : "驳回项需要重新生成后再复核；意见将保留。"}
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            {modal?.action === "respond"
              ? "答复内容"
              : modal?.action === "edit"
                ? "修改后内容"
                : "驳回原因"}
            <textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {modal?.action === "respond" ? (
            <label className="form-label">
              来源 / 版本 / 提供人
              <input
                placeholder="例如：合成客户澄清记录 V1 · §2 · 演示销售"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
          ) : null}
          <p className="muted small">
            操作人：{actor || "未填写"}
            {modal?.action === "edit" ? ` · 修改意见：${note || "未填写"}` : ""}
          </p>
          <button
            className="btn primary"
            disabled={
              !actor.trim() ||
              !text.trim() ||
              (modal?.action === "respond" && !evidence.trim()) ||
              (modal?.action === "edit" && !note.trim())
            }
            onClick={submit}
          >
            保存记录
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={writeOpen} onOpenChange={setWriteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>写回已复核的项目事实</DialogTitle>
            <DialogDescription>
              写回是内部事实快照，不自动外发，也不构成对外承诺批准。
            </DialogDescription>
          </DialogHeader>
          <p>
            写回 {state.rows.filter((r) => r.artifact !== "server").length}{" "}
            条已审工件。来源规格书 V{state.sourceVersion}；操作人 {actor}。
          </p>
          <p className="muted small">
            服务器演算保留在评审记录中；正式模型未提供，不写入有效规格事实。
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            确认澄清记录有依据，客户侧内容逐条复核，研发路径独立确认。
          </label>
          <button
            className="btn primary"
            disabled={
              !canPublishSoftware(state.role) || !ack || !ready || !actor.trim()
            }
            onClick={() => {
              dispatch({ type: "write", actor });
              setWriteOpen(false);
              setNotice("已写回内部演示事实，可在项目总览查看；未向客户发送。");
            }}
          >
            <ShieldCheck size={16} />
            确认写回
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
