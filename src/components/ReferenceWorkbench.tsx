import { SoftwareIntake } from "@/components/SoftwareIntake";
import { LocalSourceReview } from "@/components/LocalSourceReview";
import { StageHandoffs } from "@/components/Collaboration";
import { invalidInputs } from "@/lib/collaboration";
import { softwareArtifact } from "@/lib/agentTasks";
import { NodeAgent } from "@/components/NodeAgent";
import { readProjectReview, reviewKey } from "@/lib/projectReview";
import { demoReviewItems } from "@/lib/demoReview";

import { Play } from "lucide-react";
import { ReferenceDeployment } from "@/components/ReferenceDeployment";
import {
  defaultDeploymentModel,
  deploymentContext,
} from "@/lib/deploymentModel";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, FileText } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { DocumentReader, PointReader } from "@/components/SourceReader";
import {
  dependencyGate,
  referenceAction,
  referenceGate,
  referenceItems,
  type ReferenceReviewState,
} from "@/lib/referenceReview";

export function ReferenceFacts({
  projectId = "RCJM1",
}: { projectId?: string } = {}) {
  const items = projectId === "RCJM1" ? referenceItems : demoReviewItems;
  const [, refresh] = useState(0);
  useEffect(() => {
    const changed = () => refresh((n) => n + 1);
    window.addEventListener("presales-reference-change", changed);
    return () =>
      window.removeEventListener("presales-reference-change", changed);
  }, []);

  const { state } = useWorkbench();
  const review = readProjectReview(projectId, state);
  const facts = items.filter(
    (i) =>
      review.rows[i.id]?.written &&
      !(projectId !== "RCJM1" && i.category === "服务器"),
  );
  return (
    <section className="reference-facts">
      <h3>项目复核事实</h3>
      {facts.length ? (
        facts.map((i) => (
          <article key={i.id}>
            <header>
              <strong>{i.title}</strong>
              <span>
                {i.category} · {i.owner} · 修订 {review.rows[i.id].revision}
              </span>
            </header>
            <p>{review.rows[i.id].text}</p>
            <small>
              {i.source} · 复核依据：{review.rows[i.id].evidence}
            </small>
          </article>
        ))
      ) : (
        <p className="muted">尚无写回的复核事实。</p>
      )}
    </section>
  );
}
export function ReferenceWorkbench({
  stage,
  projectId = "RCJM1",
}: {
  stage: string;
  projectId?: string;
}) {
  const items = projectId === "RCJM1" ? referenceItems : demoReviewItems;
  const key = reviewKey(projectId);
  const { state, dispatch } = useWorkbench();
  const [intake, setIntake] = useState(
    state.role === "软件产品" &&
      !new URLSearchParams(window.location.search).has("item"),
  );
  const [localReview, setLocalReview] = useState(false);
  const [review, setReview] = useState<ReferenceReviewState>(() =>
    readProjectReview(projectId, state),
  );
  const [params] = useSearchParams();
  const requestedItem = items.find((i) => i.id === params.get("item"));
  const initialCategory =
    requestedItem?.category ||
    (state.role === "研发"
      ? "研发路径"
      : state.role === "解决方案"
        ? "服务器"
        : "客户应答");
  const [queueMode, setQueueMode] = useState<"要求跟进" | "交付工件">(
    state.role === "软件产品" ? "要求跟进" : "交付工件",
  );
  const [category, setCategory] = useState<string>(initialCategory);
  const [selected, setSelected] = useState(
    requestedItem?.id || items.find((i) => i.category === initialCategory)!.id,
  );
  const [deployment, setDeployment] = useState(() =>
    defaultDeploymentModel(projectId),
  );
  const [remoteConflict, setRemoteConflict] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [message, setMessage] = useState("");
  const item = items.find((i) => i.id === selected)!;
  const row = review.rows[selected];
  const receiptGate = state.deliveries.some(
    (d) =>
      d.projectId === projectId &&
      d.toStage === "F5" &&
      d.owner === state.role &&
      item.dependsOn?.includes(d.artifactId) &&
      !d.outdated &&
      d.status !== "accepted",
  )
    ? "请先接收关联交接，再复核应答"
    : "";
  const draftKey = `presales-draft:${state.accountId}:${projectId}:${selected}`;
  const [draft, setDraft] = useState<ReferenceReviewState["rows"][string]>(
    () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
        return saved?.base === JSON.stringify(row) ? saved.draft : row;
      } catch {
        return row;
      }
    },
  );
  useEffect(() => {
    if (JSON.stringify(draft) !== JSON.stringify(row))
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ base: JSON.stringify(row), draft }),
      );
    else sessionStorage.removeItem(draftKey);
    const prevent = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(draft) !== JSON.stringify(row)) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [draft, row, draftKey]);
  useEffect(() => {
    window.dispatchEvent(new Event("presales-reference-change"));
  }, [review, key]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = readProjectReview(projectId, state);
      if (
        JSON.stringify(next.rows[selected]) !==
          JSON.stringify(review.rows[selected]) &&
        JSON.stringify(draft) !== JSON.stringify(review.rows[selected])
      )
        setRemoteConflict(true);
      setReview(next);
      setDraft((current) =>
        JSON.stringify(current) === JSON.stringify(review.rows[selected])
          ? next.rows[selected]
          : current,
      );
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key, projectId, state, review, selected, draft]);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const selectItem = (id: string) => {
    setRemoteConflict(false);
    sessionStorage.removeItem(draftKey);
    setCategory(items.find((i) => i.id === id)!.category);
    setSelected(id);
    setDraft(review.rows[id]);
    setMessage("");
    setShowSource(false);
  };
  const choose = (id: string) => {
    if (JSON.stringify(draft) !== JSON.stringify(row)) {
      setPendingSelection(id);
      return;
    }
    setCategory(items.find((i) => i.id === id)!.category);
    setSelected(id);
    setDraft(review.rows[id]);
    setMessage("");
    setShowSource(false);
  };
  const update = (
    action: "edit" | "respond" | "approve" | "reject" | "write",
  ) => {
    if (remoteConflict) {
      setMessage("工件已被另一会话更新，请先核对最新版本。");
      return;
    }
    if (action === "write" && invalidInputs(state, "F5").length) {
      setMessage("上游版本已失效，请先处理交接输入。");
      return;
    }
    if ((action === "approve" || action === "write") && receiptGate) {
      setMessage(receiptGate);
      return;
    }
    const latest = readProjectReview(projectId, state);
    if (
      (action === "approve" || action === "write") &&
      dependencyGate(item, latest)
    ) {
      setMessage(dependencyGate(item, latest));
      return;
    }
    if (JSON.stringify(latest.rows[selected]) !== JSON.stringify(row)) {
      setMessage("此工件已被更新，请重新打开后复核。");
      return;
    }
    const next = referenceAction(
      latest,
      selected,
      action,
      state.role,
      draft,
      state.accountId || undefined,
      items,
    );
    if (next === latest) {
      setMessage(referenceGate(item, draft, state.role) || "请先完成复核");
      return;
    }
    dispatch({
      type: "referenceAudit",
      id: selected,
      projectId,
      action,
      before: JSON.stringify(row),
      after: JSON.stringify(next.rows[selected]),
    });
    localStorage.setItem(key, JSON.stringify(next));
    if (
      action === "write" &&
      !(projectId !== "RCJM1" && item.category === "服务器")
    )
      dispatch({
        type: "publishSoftware",
        projectId,
        artifactId: item.id,
        title: item.title,
        text:
          (next.rows[selected].disposition
            ? "应答结论：" + next.rows[selected].disposition + "\n"
            : "") +
          next.rows[selected].text +
          (item.category === "研发路径"
            ? "\n\n实现方式：" +
              next.rows[selected].implementation +
              "\n成本比较：" +
              next.rows[selected].costBasis
            : "") +
          (next.rows[selected].resolution
            ? "\n\n确认条件：" + next.rows[selected].resolution
            : ""),
        evidence: next.rows[selected].evidence + "；" + item.source,
        version: "R" + next.rows[selected].revision,
        category: item.category,
      });
    setReview(next);
    setDraft(next.rows[selected]);
    setMessage(
      action === "write"
        ? "已保存到项目复核事实"
        : action === "approve"
          ? "已复核"
          : action === "reject"
            ? "已驳回，修改后重新复核"
            : "已保存，等待复核",
    );
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(row);
  const originGate = items.some(
    (root) =>
      root.category === "客户应答" &&
      root.dependsOn?.includes(item.id) &&
      review.rows[root.id].extraction?.status !== "confirmed",
  )
    ? "先由软件产品核对关联要求的原文提取"
    : "";
  const gate =
    originGate ||
    receiptGate ||
    dependencyGate(item, review) ||
    referenceGate(item, row, state.role);
  const dependencies = (item.dependsOn || [])
    .map((id) => items.find((i) => i.id === id)!)
    .filter(Boolean);
  const related = items.filter((i) => i.dependsOn?.includes(item.id));
  const linkedContext = dependencies
    .map((i) => {
      const value = review.rows[i.id];
      return `${i.category} · ${i.title} · R${value.revision} · ${value.written && value.status === "approved" ? "已确认" : "待确认"} · ${i.owner}\n${value.text}\n实现方式：${value.implementation || "未选定"}；成本依据：${value.costBasis || "未登记"}\n确认：${value.resolution || "未登记"}；依据：${value.evidence || "未登记"}`;
    })
    .join("\n\n");
  if (localReview) return (
    <section className="reference-workbench">
      <header className="reference-workbench-heading">
        <h2>F5 · 本机资料核对</h2>
        <button className="btn secondary" onClick={() => setLocalReview(false)}>返回工作区</button>
      </header>
      <LocalSourceReview projectId={projectId} />
    </section>
  );
  return (
    <section className="reference-workbench">
      <header className="reference-workbench-heading">
        <h2>{stage === "F3" ? "F3 · 点表核对" : "F5 · 软件技术支持"}</h2>
        {row.status === "rejected" && state.role === item.owner && (
          <button
            className="btn secondary"
            onClick={() => {
              const next = referenceAction(
                review,
                selected,
                "edit",
                state.role,
                { ...row, text: item.draft, note: row.note },
                state.accountId || undefined,
                items,
              );
              dispatch({
                type: "referenceAudit",
                projectId,
                id: selected,
                action: "regenerate",
                before: JSON.stringify(row),
                after: JSON.stringify(next.rows[selected]),
              });
              localStorage.setItem(key, JSON.stringify(next));
              setReview(next);
              setDraft(next.rows[selected]);
              setMessage("草稿已更新，等待复核");
            }}
          >
            <Play size={14} />
            重新生成
          </button>
        )}
        <button className="btn secondary" onClick={() => setIntake(!intake)}>
          {intake ? "专业工作区" : "资料提取与核对"}
        </button>
        {stage !== "F3" && <button className="btn secondary" onClick={() => setLocalReview(true)}>本机资料核对</button>}
        <button
          className="btn secondary"
          onClick={() => setShowAudit(!showAudit)}
        >
          复核记录 {review.audit.length}
        </button>
      </header>
      <StageHandoffs projectId={projectId} stage="F5" />
      {state.followups
        .filter(
          (f) =>
            f.projectId === projectId &&
            f.url?.endsWith("&item=" + selected) &&
            f.owner === state.role &&
            f.status !== "done",
        )
        .map((f) => (
          <div className="software-assignment" key={f.id}>
            <strong>{f.title}</strong>
            <span>{f.createdRole}</span>
            <button
              className="btn secondary"
              disabled={!row.written}
              onClick={() =>
                dispatch({
                  type: "followupComplete",
                  id: f.id,
                  projectId,
                  result: `${item.title} R${row.revision}：${row.resolution || row.text}；依据：${row.evidence}`,
                })
              }
            >
              完成确认
            </button>
          </div>
        ))}
      {remoteConflict && (
        <div className="draft-switch-prompt" role="alert">
          <strong>另一会话已更新此工件，本地修改尚未提交</strong>
          <button
            className="btn secondary"
            onClick={() => navigator.clipboard.writeText(draft.text)}
          >
            复制本地修改
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setDraft(row);
              setRemoteConflict(false);
              setMessage("");
            }}
          >
            使用最新版本
          </button>
        </div>
      )}
      {pendingSelection && (
        <div className="draft-switch-prompt" role="alert">
          <strong>当前修改尚未保存</strong>
          <button
            className="btn secondary"
            onClick={() => setPendingSelection(null)}
          >
            继续编辑
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              selectItem(pendingSelection);
              setPendingSelection(null);
            }}
          >
            放弃修改并切换
          </button>
        </div>
      )}
      {intake && stage !== "F3" ? (
        <SoftwareIntake
          projectId={projectId}
          items={items}
          review={review}
          onChange={(next) => {
            setReview(next);
            setDraft(next.rows[selected]);
          }}
          onContinue={(id) => {
            if (id) selectItem(id);
            setIntake(false);
          }}
        />
      ) : stage === "F3" ? (
        <PointReader />
      ) : (
        <>
          <div className="software-workbar">
            <div className="software-view-switch">
              {(["要求跟进", "交付工件"] as const).map((mode) => (
                <button
                  key={mode}
                  className={queueMode === mode ? "active" : ""}
                  onClick={() => setQueueMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <span>
              {items.filter((i) => i.category === "客户应答").length} 条要求
            </span>
            <span>
              {
                items.filter((i) => i.blocker && !review.rows[i.id].resolution)
                  .length
              }{" "}
              项待确认
            </span>
            <span>
              {items.filter((i) => review.rows[i.id].written).length} 项已发布
            </span>
          </div>
          {queueMode === "交付工件" && (
            <div className="reference-review-tabs">
              {["客户应答", "澄清", "研发路径", "服务器"].map((c) => (
                <button
                  key={c}
                  className={category === c ? "active" : ""}
                  onClick={() => {
                    choose(items.find((i) => i.category === c)!.id);
                  }}
                >
                  {c}
                  <span>{items.filter((i) => i.category === c).length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="reference-review-layout">
            <nav aria-label="软件复核队列">
              {items
                .filter((i) =>
                  queueMode === "要求跟进"
                    ? i.category === "客户应答"
                    : i.category === category,
                )
                .map((i) => (
                  <button
                    className={i.id === selected ? "selected" : ""}
                    onClick={() => choose(i.id)}
                    key={i.id}
                  >
                    <strong>{i.title}</strong>
                    <small>
                      {i.requirementType ||
                        (/OPC|接口/.test(i.title)
                          ? "接入"
                          : /历史|性能/.test(i.title)
                            ? "原则"
                            : "功能")}
                    </small>
                    <span>
                      {review.rows[i.id].written
                        ? "已写回"
                        : review.rows[i.id].status === "approved"
                          ? "已复核"
                          : review.rows[i.id].status === "rejected"
                            ? "已驳回"
                            : i.blocker && !review.rows[i.id].resolution
                              ? "待确认"
                              : "待复核"}
                    </span>
                  </button>
                ))}
            </nav>
            <article className="reference-review-editor">
              <header>
                <h3>{item.title}</h3>
                <span>{item.owner}</span>
              </header>
              <div className="software-chain" aria-label="关联工件">
                {[...dependencies, item, ...related].map((i) => {
                  const value = review.rows[i.id];
                  return (
                    <button
                      key={i.id}
                      className={i.id === selected ? "current" : ""}
                      onClick={() => choose(i.id)}
                    >
                      <span>
                        {i.category} · {i.owner}
                      </span>
                      <strong>{i.title}</strong>
                      <small>
                        {value.written && value.status === "approved"
                          ? "已发布"
                          : value.status === "approved"
                            ? "已复核"
                            : "待确认"}{" "}
                        · R{value.revision}
                      </small>
                    </button>
                  );
                })}
              </div>
              {dependencies.length > 0 && (
                <section className="software-dependencies">
                  <h4>确认输入</h4>
                  {dependencies.map((i) => {
                    const value = review.rows[i.id];
                    return (
                      <div key={i.id}>
                        <button onClick={() => choose(i.id)}>{i.title}</button>
                        <span>
                          {value.written && value.status === "approved"
                            ? "已确认"
                            : "待" + i.owner + "确认"}{" "}
                          · R{value.revision}
                        </span>
                        {!value.written &&
                          state.role === "软件产品" &&
                          i.owner !== state.role && (
                            <button
                              className="software-request"
                              disabled={state.followups.some(
                                (f) =>
                                  f.projectId === projectId &&
                                  f.url?.endsWith("&item=" + i.id) &&
                                  f.status !== "done",
                              )}
                              onClick={() => {
                                dispatch({
                                  type: "followup",
                                  projectId,
                                  title: item.title + "：确认" + i.title,
                                  owner: i.owner,
                                  source:
                                    item.source +
                                    " · " +
                                    item.id +
                                    " R" +
                                    row.revision,
                                  url: `/projects/${projectId}?view=review&stage=F5&item=${i.id}`,
                                });
                                setMessage("已向" + i.owner + "发起确认");
                              }}
                            >
                              {state.followups.some(
                                (f) =>
                                  f.projectId === projectId &&
                                  f.url?.endsWith("&item=" + i.id) &&
                                  f.status !== "done",
                              )
                                ? "已发起确认"
                                : "发起确认"}
                            </button>
                          )}
                        <p>
                          {value.written
                            ? value.resolution || value.text
                            : i.blocker || "尚未完成复核与发布"}
                        </p>
                      </div>
                    );
                  })}
                </section>
              )}
              {item.capability && (
                <div className="software-capability">
                  <strong>能力匹配依据</strong>
                  <p>{item.capability}</p>
                </div>
              )}
              {category === "服务器" && (
                <ReferenceDeployment
                  projectId={projectId}
                  model={deployment}
                  onChange={setDeployment}
                />
              )}
              <div className="requirement-extract">
                <p>{row.extraction?.requirement || item.requirement}</p>
                {category === "客户应答" && (
                  <button onClick={() => setIntake(true)}>
                    {row.extraction?.status === "confirmed"
                      ? "查看原文核对记录"
                      : "先核对提取要求"}
                  </button>
                )}
                <button onClick={() => setShowSource(!showSource)}>
                  <FileText size={13} />
                  {item.source}
                </button>
              </div>
              {item.blocker && !row.resolution && (
                <div className="reference-blocker">{item.blocker}</div>
              )}
              {category === "客户应答" && (
                <label className="software-disposition">
                  应答结论
                  <select
                    value={draft.disposition || ""}
                    disabled={state.role !== item.owner}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        disposition: e.target.value as typeof draft.disposition,
                      })
                    }
                  >
                    <option value="">选择结论</option>
                    {["满足", "偏离", "不满足", "待澄清"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              )}
              {category === "研发路径" && (
                <section className="software-path-decision">
                  <label className="software-disposition">
                    实现方式
                    <select
                      value={draft.implementation || ""}
                      disabled={state.role !== item.owner}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          implementation: e.target
                            .value as typeof draft.implementation,
                        })
                      }
                    >
                      <option value="">选择方案</option>
                      {["复用", "适配", "定制", "第三方"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="form-label">
                    成本比较
                    <textarea
                      rows={3}
                      readOnly={state.role !== item.owner}
                      placeholder="逐项记录候选方案的工时、许可费、交付约束，以及选用理由"
                      value={draft.costBasis || ""}
                      onChange={(e) =>
                        setDraft({ ...draft, costBasis: e.target.value })
                      }
                    />
                  </label>
                </section>
              )}
              <label className="form-label">
                {category === "澄清"
                  ? "澄清问题"
                  : category === "研发路径"
                    ? "内部路径"
                    : category === "服务器"
                      ? "规格与验证条件"
                      : "客户应答草稿"}
                <textarea
                  rows={4}
                  readOnly={state.role !== item.owner}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </label>
              {item.blocker && (
                <label className="form-label">
                  确认结果
                  <textarea
                    rows={2}
                    placeholder="记录确认范围、结论与限制"
                    readOnly={state.role !== item.owner}
                    value={draft.resolution}
                    onChange={(e) =>
                      setDraft({ ...draft, resolution: e.target.value })
                    }
                  />
                </label>
              )}
              <div className="form-row">
                <label className="form-label">
                  复核 / 确认依据
                  <input
                    placeholder="文档版本、条款、测试记录或书面答复"
                    readOnly={state.role !== item.owner}
                    value={draft.evidence}
                    onChange={(e) =>
                      setDraft({ ...draft, evidence: e.target.value })
                    }
                  />
                </label>
                <label className="form-label">
                  复核意见
                  <input
                    readOnly={state.role !== item.owner}
                    value={draft.note}
                    onChange={(e) =>
                      setDraft({ ...draft, note: e.target.value })
                    }
                  />
                </label>
              </div>
              {state.role === item.owner && (
                <div className="actions">
                  <button
                    className="btn secondary"
                    disabled={
                      state.role !== item.owner || !dirty || !draft.text.trim()
                    }
                    onClick={() => update("edit")}
                  >
                    保存修改
                  </button>
                  {item.blocker && (
                    <button
                      className="btn secondary"
                      disabled={
                        state.role !== item.owner ||
                        !draft.resolution.trim() ||
                        !draft.evidence.trim()
                      }
                      onClick={() => update("respond")}
                    >
                      登记答复
                    </button>
                  )}
                  <button
                    className="btn primary"
                    disabled={dirty || !!gate || row.status === "approved"}
                    title={gate || undefined}
                    onClick={() => update("approve")}
                  >
                    <Check size={14} />
                    复核通过
                  </button>
                  <button
                    className="btn secondary"
                    disabled={
                      dirty || !row.note.trim() || state.role !== item.owner
                    }
                    onClick={() => update("reject")}
                  >
                    驳回
                  </button>
                  <button
                    className="btn secondary"
                    disabled={
                      dirty ||
                      row.status !== "approved" ||
                      (projectId !== "RCJM1" && category === "服务器") ||
                      !!gate ||
                      row.written
                    }
                    onClick={() => update("write")}
                  >
                    写回项目事实
                  </button>
                </div>
              )}
              <p className="review-message" role="status">
                {message ||
                  (dirty
                    ? "修改尚未保存"
                    : dependencies.length && dependencyGate(item, review)
                      ? "先完成关联确认，再复核本条应答。"
                      : "")}
              </p>
              {showSource && projectId !== "RCJM1" && (
                <div className="source-quotation">
                  <h4>规格要求</h4>
                  <p>{item.requirement}</p>
                  <small>{item.source}</small>
                </div>
              )}
              {showSource && projectId === "RCJM1" && (
                <DocumentReader
                  key={item.document + item.page}
                  document={item.document}
                  initialPage={item.page}
                />
              )}
            </article>
            <NodeAgent
              key={projectId + selected + state.accountId}
              stage="F5"
              projectId={projectId}
              artifact={{
                ...softwareArtifact(item, row),
                requirement: row.extraction?.requirement || item.requirement,
                pendingDependencies: !!dependencyGate(item, review),
                followupTarget: dependencies.find(
                  (i) => !review.rows[i.id].written,
                )
                  ? {
                      id: dependencies.find((i) => !review.rows[i.id].written)!
                        .id,
                      owner: dependencies.find(
                        (i) => !review.rows[i.id].written,
                      )!.owner,
                    }
                  : undefined,
                blocker: dependencyGate(item, review) || item.blocker,
                context:
                  item.category === "服务器"
                    ? deploymentContext(projectId, deployment)
                    : [item.capability, linkedContext]
                        .filter(Boolean)
                        .join("\n\n"),
              }}
              applyBlocked={dirty}
              onSource={() => setShowSource(true)}
              onApply={
                state.role === item.owner
                  ? (text) => {
                      setDraft({ ...draft, text });
                      setMessage("请保存修改并复核。");
                    }
                  : undefined
              }
            />
          </div>
        </>
      )}
      {showAudit && (
        <section className="reference-audit">
          <h3>复核记录</h3>
          {review.audit.length ? (
            review.audit.map((a) => (
              <div key={a.id}>
                <span>{new Date(a.at).toLocaleString("zh-CN")}</span>
                <strong>{items.find((i) => i.id === a.target)?.title}</strong>
                <span>
                  {
                    (
                      {
                        extract: "提取要求",
                        verify: "核对原文",
                        edit: "修改",
                        respond: "答复",
                        approve: "复核通过",
                        reject: "驳回",
                        write: "写回",
                      } as Record<string, string>
                    )[a.action]
                  }{" "}
                  · {a.actor}
                </span>
                <p>
                  {a.note} · {a.source} · 修订 {a.revision}
                </p>
                <details>
                  <summary>内容记录</summary>
                  <p>之前：{a.before}</p>
                  <p>之后：{a.after}</p>
                </details>
              </div>
            ))
          ) : (
            <p>尚无复核操作。</p>
          )}
        </section>
      )}
    </section>
  );
}
