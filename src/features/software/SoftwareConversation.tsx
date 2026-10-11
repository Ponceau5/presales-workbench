import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { readProjectReview, reviewKey } from "@/lib/projectReview";
import { demoReviewItems } from "@/lib/demoReview";
import {
  dependencyGate,
  referenceAction,
  referenceGate,
  referenceItems,
  type ReferenceItem,
  type ReferenceReviewRow,
  type ReferenceReviewState,
} from "@/lib/referenceReview";
import "./software-conversation.css";

type ActionKind = "edit" | "respond" | "approve" | "reject" | "write" | "verify";
type ArtifactId = "server" | "clarify" | "answer" | "judgement" | "plan" | "bid";

interface Msg {
  id: string;
  role: "agent" | "you";
  text: string;
  artifacts?: ArtifactId[];
}

const ARTIFACTS: Record<
  ArtifactId,
  { title: string; cats: string[]; hint: string }
> = {
  server: { title: "服务器规格方案", cats: ["服务器"], hint: "预审后转交解决方案" },
  clarify: { title: "澄清表", cats: ["澄清"], hint: "审核后发出给客户" },
  answer: { title: "应答/偏离表", cats: ["客户应答"], hint: "客户侧内容，逐条有依据" },
  judgement: { title: "答复与判定", cats: [], hint: "客户+研发答复回流后的判定" },
  plan: { title: "技术方案（研发路径）", cats: ["研发路径"], hint: "预审后转交研发" },
  bid: { title: "技术标书", cats: [], hint: "终审后由你外发" },
};

const QUICK = [
  "读取规格书和清单，生成本项目草稿",
  "哪些需求要向客户澄清？",
  "把告警回溯视频整理成给研发的问题",
  "组装技术标书",
];

export function SoftwareConversation({ projectId }: { projectId: string }) {
  const { state, dispatch } = useWorkbench();
  const items = useMemo(
    () => (projectId === "RCJM1" ? referenceItems : demoReviewItems),
    [projectId],
  );
  const key = reviewKey(projectId);
  const [review, setReview] = useState<ReferenceReviewState>(() =>
    readProjectReview(projectId, state),
  );
  const [handed, setHanded] = useState<Set<string>>(new Set());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<ArtifactId | null>(null);
  const [comment, setComment] = useState("");
  const [choices, setChoices] = useState<
    Record<string, { disposition?: string; implementation?: string; costBasis?: string; resolution?: string }>
  >({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [notice, setNotice] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [answersReady, setAnswersReady] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const row = (id: string) => review.rows[id];
  const rowsOf = (a: ArtifactId): ReferenceItem[] =>
    a === "judgement"
      ? items.filter((i) => i.blocker)
      : a === "bid"
        ? items.filter(
            (i) => !(projectId !== "RCJM1" && i.category === "服务器"),
          )
        : items.filter((i) => ARTIFACTS[a].cats.includes(i.category));

  const rowDone = (id: string) =>
    row(id).status === "approved" || handed.has(id);
  const artifactDone = (a: ArtifactId): boolean => {
    if (a === "judgement")
      return rowsOf(a).every(
        (i) => row(i.id).resolution.trim() || row(i.id).written,
      );
    if (a === "bid") return rowsOf(a).every((i) => row(i.id).written);
    return rowsOf(a).every((i) => rowDone(i.id));
  };

  const step: ArtifactId = !["server", "clarify", "answer"].every((a) =>
    artifactDone(a as ArtifactId),
  )
    ? (["server", "clarify", "answer"].find(
        (a) => !artifactDone(a as ArtifactId),
      ) as ArtifactId)
    : !artifactDone("judgement")
      ? "judgement"
      : !artifactDone("plan")
        ? "plan"
        : !artifactDone("bid")
          ? "bid"
          : "bid";

  const allDone = ["server", "clarify", "answer", "judgement", "plan", "bid"].every(
    (a) => artifactDone(a as ArtifactId),
  );

  const needIds = (["server", "clarify", "answer"] as ArtifactId[]).filter(
    (a) => !artifactDone(a),
  );
  const need: { label: string; artifacts: ArtifactId[] } | null = allDone
    ? null
    : needIds.length
      ? { label: `需要你审核 ${needIds.length} 件草稿`, artifacts: needIds }
      : step === "judgement"
        ? answersReady
          ? { label: "答复回来了，需要你确认判定", artifacts: ["judgement"] }
          : null
        : step === "plan"
          ? { label: "需要你复核技术方案", artifacts: ["plan"] }
          : { label: "技术标书待终审", artifacts: ["bid"] };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs, busy]);

  const post = (role: "agent" | "you", text: string, artifacts?: ArtifactId[]) =>
    setMsgs((m) => [
      ...m,
      { id: crypto.randomUUID(), role, text, artifacts },
    ]);

  function persist(
    item: ReferenceItem,
    action: ActionKind,
    patch: Partial<ReferenceReviewRow>,
  ) {
    const latest = readProjectReview(projectId, state);
    const next = referenceAction(
      latest,
      item.id,
      action,
      state.role,
      patch,
      state.accountId || undefined,
      items,
    );
    if (next === latest) return false;
    dispatch({
      type: "referenceAudit",
      id: item.id,
      projectId,
      action,
      before: JSON.stringify(latest.rows[item.id]),
      after: JSON.stringify(next.rows[item.id]),
    });
    localStorage.setItem(key, JSON.stringify(next));
    if (action === "write")
      dispatch({
        type: "publishSoftware",
        projectId,
        artifactId: item.id,
        title: item.title,
        text:
          (next.rows[item.id].disposition
            ? "应答结论：" + next.rows[item.id].disposition + "\n"
            : "") +
          next.rows[item.id].text +
          (item.category === "研发路径"
            ? "\n\n实现方式：" +
              next.rows[item.id].implementation +
              "\n成本比较：" +
              next.rows[item.id].costBasis
            : "") +
          (next.rows[item.id].resolution
            ? "\n\n确认条件：" + next.rows[item.id].resolution
            : ""),
        evidence: next.rows[item.id].evidence + "；" + item.source,
        version: "R" + next.rows[item.id].revision,
        category: item.category,
      });
    setReview(next);
    window.dispatchEvent(new Event("presales-reference-change"));
    return true;
  }

  function handoff(item: ReferenceItem) {
    dispatch({
      type: "followup",
      projectId,
      title: item.title + "（预审通过，待正式复核）",
      owner: item.owner,
      source: item.source,
      url: `/projects/${projectId}?view=review&stage=F5`,
    });
    setHanded((h) => new Set(h).add(item.id));
  }

  function validate(rows: ReferenceItem[]): string {
    for (const item of rows) {
      if (state.role !== item.owner) continue;
      const r = row(item.id);
      const c = choices[item.id] || {};
      if (item.category === "客户应答") {
        if (r.extraction?.status !== "confirmed")
          return `「${item.title}」先对照原文确认提取`;
        if (!(c.disposition || r.disposition))
          return `「${item.title}」未选应答结论`;
      }
      if (item.category === "研发路径") {
        if (!(c.implementation || r.implementation))
          return `「${item.title}」未选实现方式`;
        if (!(c.costBasis ?? r.costBasis)?.trim())
          return `「${item.title}」未填成本比较依据`;
      }
      const gate =
        dependencyGate(item, review) || referenceGate(item, r, state.role);
      if (gate && gate !== `由${item.owner}复核`) return gate;
    }
    return "";
  }

  function approveArtifact(a: ArtifactId) {
    const rows = rowsOf(a).filter((i) => !artifactRowDone(i));
    const problem = validate(rows);
    if (problem) {
      setNotice(problem);
      return;
    }
    let handedOff = 0;
    for (const item of rows) {
      if (state.role !== item.owner) {
        handoff(item);
        handedOff++;
        continue;
      }
      const r = row(item.id);
      const c = choices[item.id] || {};
      persist(item, "approve", {
        note: comment.trim() || r.note || "确认无误",
        evidence: r.evidence.trim() || item.source,
        disposition: (c.disposition ||
          r.disposition) as ReferenceReviewRow["disposition"],
        implementation: (c.implementation ||
          r.implementation) as ReferenceReviewRow["implementation"],
        costBasis: c.costBasis ?? r.costBasis,
      });
    }
    post(
      "you",
      `已通过「${ARTIFACTS[a].title}」${handedOff ? `（${handedOff} 件转交正式复核人）` : ""}${comment.trim() ? "：" + comment.trim() : ""}`,
    );
    closeDrawer();
    advanceAfter(a);
  }

  function artifactRowDone(item: ReferenceItem) {
    return rowDone(item.id);
  }

  function advanceAfter(a: ArtifactId) {
    window.setTimeout(() => {
      if (["server", "clarify", "answer"].includes(a)) {
        const left = (["server", "clarify", "answer"] as ArtifactId[]).filter(
          (x) => !artifactDone(x),
        );
        if (!left.length) {
          post(
            "agent",
            "草稿全部确认了。澄清表我会按你确认的口径发出；答复回来我先整理成判定依据，再叫你。",
          );
          window.setTimeout(() => {
            setAnswersReady(true);
            post(
              "agent",
              "答复回来了（演示）：客户确认「告警回溯」按抓拍 + 事件前后片段理解；研发认为复用录像平台可行。我已整理成判定依据，请确认。",
              ["judgement"],
            );
          }, 1800);
        }
      }
      if (a === "judgement")
        post("agent", "判定收到。需开发项的技术方案草稿已出，请复核。", ["plan"]);
      if (a === "plan")
        post("agent", "方案通过。已组装技术标书初稿，请终审。", ["bid"]);
    }, 600);
  }

  function rejectArtifact(a: ArtifactId) {
    if (!comment.trim()) {
      setNotice("驳回前写一句意见，我会按它重做并留痕。");
      return;
    }
    const rows = rowsOf(a);
    for (const item of rows) {
      if (state.role !== item.owner || row(item.id).status === "approved")
        continue;
      persist(item, "reject", { note: comment.trim() });
    }
    post("you", `驳回「${ARTIFACTS[a].title}」：${comment.trim()}`);
    closeDrawer();
    setBusy(true);
    window.setTimeout(() => {
      const latest = readProjectReview(projectId, state);
      let next = latest;
      for (const item of rows) {
        if (state.role !== item.owner) continue;
        if (next.rows[item.id].status !== "rejected") continue;
        next = referenceAction(
          next,
          item.id,
          "edit",
          state.role,
          { text: item.draft, note: "Agent 按驳回意见重做：" + comment.trim() },
          state.accountId || undefined,
          items,
        );
      }
      if (next !== latest) {
        localStorage.setItem(key, JSON.stringify(next));
        setReview(next);
      }
      setBusy(false);
      post("agent", `已按你的意见重做「${ARTIFACTS[a].title}」，请再审。`, [a]);
    }, 900);
  }

  function saveRowEdit(item: ReferenceItem) {
    if (!editText.trim()) return;
    if (state.role !== item.owner) {
      setNotice(`本条由 ${item.owner} 复核，演示中可先批注。`);
      return;
    }
    if (
      persist(item, "edit", {
        text: editText,
        note: comment.trim() || "人工改写",
        evidence: row(item.id).evidence.trim() || item.source,
      })
    ) {
      post("you", `改写了「${item.title}」`);
      setEditing(null);
    }
  }

  function confirmJudgement() {
    const rows = rowsOf("judgement");
    for (const item of rows) {
      const c = choices[item.id] || {};
      const resolution = (c.resolution ?? row(item.id).resolution).trim();
      if (!resolution) {
        setNotice(`「${item.title}」还没登记答复结论。`);
        return;
      }
    }
    for (const item of rows) {
      if (state.role !== item.owner) {
        handoff(item);
        continue;
      }
      if (row(item.id).resolution.trim()) continue;
      const c = choices[item.id] || {};
      persist(item, "respond", {
        text: row(item.id).text,
        resolution: c.resolution ?? "",
        evidence: row(item.id).evidence.trim() || item.source,
        note: comment.trim() || "答复已登记",
      });
    }
    post("you", "已确认答复与判定");
    closeDrawer();
    advanceAfter("judgement");
  }

  function finalWrite() {
    for (const item of rowsOf("bid")) {
      if (row(item.id).written || row(item.id).status !== "approved") continue;
      if (state.role !== item.owner) {
        handoff(item);
        continue;
      }
      persist(item, "write", {});
    }
    post("you", "终审通过，已写回项目事实");
    closeDrawer();
    window.setTimeout(
      () =>
        post(
          "agent",
          "全部写回完成。服务器规格已可交付解决方案，技术标书终稿由你外发——我不会直接对客户承诺。",
        ),
      600,
    );
  }

  function runAgent(text?: string) {
    if (busy) return;
    setBusy(true);
    post("you", text || "读取规格书与清单，生成本项目草稿");
    const steps = [
      "收到。正在读取技术规格书与配置清单、项目规模…",
      "已拆解出 6 条软件要求：原则类 2、平台接入 2、功能类 2，其中 1 条表述有歧义。",
      "草稿已生成：澄清表、应答/偏离表、服务器规格方案，每条附原文依据。",
    ];
    steps.forEach((s, i) =>
      window.setTimeout(() => post("agent", s), 620 * (i + 1)),
    );
    window.setTimeout(() => {
      const left = (["server", "clarify", "answer"] as ArtifactId[]).filter(
        (a) => !artifactDone(a),
      );
      if (left.length)
        post(
          "agent",
          "草稿齐了。审核入口在下面这条提醒里——点哪件看哪件，其余我继续守着。",
        );
      else post("agent", "草稿都已确认，我继续盯答复和方案，有需要会叫你。");
      setBusy(false);
    }, 620 * (steps.length + 1));
  }

  function ask(text: string) {
    if (busy || !text.trim()) return;
    setInput("");
    if (/澄清/.test(text)) {
      post("you", text);
      window.setTimeout(
        () =>
          post(
            "agent",
            "当前最需要澄清的是「告警回溯视频」：抓拍、片段调取、全量历史存储是三种成本。已整理进澄清表，等你审核后发出。",
            ["clarify"],
          ),
        500,
      );
      return;
    }
    if (/研发|告警回溯/.test(text)) {
      post("you", text);
      window.setTimeout(
        () =>
          post(
            "agent",
            "已整理成研发视角：复用客户录像平台、按告警事件索引片段是最低成本候选；全量历史存储需单独评估。放在技术方案里了。",
            ["plan"],
          ),
        500,
      );
      return;
    }
    if (/标书/.test(text)) {
      post("you", text);
      window.setTimeout(
        () =>
          post(
            "agent",
            artifactDone("plan")
              ? "标书初稿已组装好，等你终审。"
              : "草稿和方案还没齐——先完成上面的审核，我再组装标书。",
            artifactDone("plan") ? ["bid"] : undefined,
          ),
        500,
      );
      return;
    }
    runAgent(text);
  }

  function openDrawer(a: ArtifactId) {
    setDrawer(a);
    setComment("");
    setNotice("");
    setEditing(null);
  }
  function closeDrawer() {
    setDrawer(null);
    setNotice("");
    setEditing(null);
  }

  const drawerRows = drawer ? rowsOf(drawer) : [];

  return (
    <section className="convo">
      <header className="convo-top">
        <div className="convo-title">
          <span className="convo-mark"><Sparkles size={15} /></span>
          <div>
            <strong>软件 Agent</strong>
            <small>F5 · 软件技术支持 · 演示模式（未接模型，审核真实生效）</small>
          </div>
        </div>
      </header>

      {msgs.length === 0 ? (
        <div className="convo-center">
          <div className="convo-hero">
            <span className="convo-mark big"><Sparkles size={20} /></span>
            <h2>要做什么？</h2>
            <p>我读规格书、出草稿、盯答复。你只做审核——需要审的时候我会叫你。</p>
          </div>
          {need && (
            <div className="convo-need compact">
              <span className="convo-mark"><Sparkles size={13} /></span>
              <strong>{need.label}</strong>
              <div className="convo-chips">
                {need.artifacts.map((a) => (
                  <button key={a} onClick={() => openDrawer(a)}>
                    {ARTIFACTS[a].title}
                    <ArrowRight size={12} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="convo-composer center">
            <textarea
              rows={1}
              placeholder="告诉我要做什么…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
            />
            <button aria-label="发送" disabled={busy || !input.trim()} onClick={() => ask(input)}>
              <ArrowUp size={16} />
            </button>
          </div>
          <div className="convo-quick center">
            {QUICK.map((q) => (
              <button key={q} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="convo-stream">
            {msgs.map((m) => (
              <div key={m.id} className={"convo-msg " + m.role}>
                {m.role === "agent" && (
                  <span className="convo-mark"><Sparkles size={13} /></span>
                )}
                <div className="convo-bubble">
                  <p>{m.text}</p>
                  {m.artifacts && (
                    <div className="convo-chips">
                      {m.artifacts.map((a) => (
                        <button key={a} onClick={() => openDrawer(a)}>
                          {artifactDone(a) && <CheckCircle2 size={12} />}
                          {ARTIFACTS[a].title}
                          <ArrowRight size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="convo-msg agent">
                <span className="convo-mark"><Sparkles size={13} /></span>
                <div className="convo-bubble working">
                  <LoaderCircle size={14} className="convo-spin" /> 正在工作…
                </div>
              </div>
            )}
            {need && (
              <div className="convo-need">
                <span className="convo-mark"><Sparkles size={13} /></span>
                <div>
                  <strong>{need.label}</strong>
                  <div className="convo-chips">
                    {need.artifacts.map((a) => (
                      <button key={a} onClick={() => openDrawer(a)}>
                        {ARTIFACTS[a].title}
                        <ArrowRight size={12} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="convo-bottom">
            {quickOpen && (
              <div className="convo-quick-pop">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuickOpen(false);
                      ask(q);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="convo-composer">
              <button
                className="convo-plus"
                aria-label="快捷选项"
                onClick={() => setQuickOpen(!quickOpen)}
              >
                +
              </button>
              <textarea
                rows={1}
                placeholder="告诉我要做什么…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
              />
              <button aria-label="发送" disabled={busy || !input.trim()} onClick={() => ask(input)}>
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      {drawer && (
        <>
          <div className="convo-scrim" onClick={closeDrawer} />
          <aside className="convo-drawer" aria-label="审核材料">
            <header>
              <div>
                <strong>审核 · {ARTIFACTS[drawer].title}</strong>
                <small>{ARTIFACTS[drawer].hint}</small>
              </div>
              <button aria-label="关闭" onClick={closeDrawer}><X size={16} /></button>
            </header>

            <div className="convo-drawer-body">
              {drawer === "bid" ? (
                <>
                  <p className="convo-drawer-note">
                    终审稿 = 已复核的应答、澄清、研发路径与服务器规格。逐项写回项目事实：
                  </p>
                  {drawerRows.map((item) => (
                    <div className="convo-write-row" key={item.id}>
                      <span>{item.title}</span>
                      <small>{item.category} · R{row(item.id).revision}</small>
                      {row(item.id).written || handed.has(item.id) ? (
                        <span className="convo-tag ok">已写回</span>
                      ) : (
                        <span className="convo-tag">待写回</span>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                drawerRows.map((item) => {
                  const r = row(item.id);
                  const mine = state.role === item.owner;
                  return (
                    <div className="convo-row" key={item.id}>
                      <header>
                        <strong>{item.title}</strong>
                        {rowDone(item.id) && <CheckCircle2 size={14} className="convo-row-ok" />}
                      </header>
                      <button className="convo-source">
                        <FileText size={12} />{item.source}
                      </button>
                      {editing === item.id ? (
                        <textarea
                          className="convo-row-editor"
                          rows={4}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                      ) : (
                        <p>{r.text}</p>
                      )}
                      {mine && drawer !== "judgement" && (
                        <div className="convo-row-actions">
                          {editing === item.id ? (
                            <>
                              <button className="convo-mini" onClick={() => saveRowEdit(item)}>保存改写</button>
                              <button className="convo-mini" onClick={() => setEditing(null)}>收起</button>
                            </>
                          ) : (
                            <button
                              className="convo-mini"
                              onClick={() => {
                                setEditing(item.id);
                                setEditText(r.text);
                              }}
                            >
                              改写
                            </button>
                          )}
                        </div>
                      )}
                      {!mine && (
                        <small className="convo-row-owner">正式复核：{item.owner}（你预审后转交）</small>
                      )}
                      {item.category === "客户应答" && mine && (
                        <div className="convo-field">
                          {r.extraction?.status !== "confirmed" ? (
                            <button
                              className="convo-verify"
                              onClick={() =>
                                persist(item, "verify", {
                                  extraction: {
                                    runId: crypto.randomUUID(),
                                    at: new Date().toISOString(),
                                    source: item.source,
                                    requirement:
                                      r.extraction?.requirement || item.requirement,
                                    status: "candidate",
                                  },
                                })
                              }
                            >
                              先对照原文确认提取
                            </button>
                          ) : (
                            <span className="convo-tag ok">原文已核对</span>
                          )}
                          <div className="convo-chips">
                            {["满足", "偏离", "不满足", "待澄清"].map((d) => (
                              <button
                                key={d}
                                className={
                                  (choices[item.id]?.disposition || r.disposition) === d
                                    ? "active"
                                    : ""
                                }
                                onClick={() =>
                                  setChoices((c) => ({
                                    ...c,
                                    [item.id]: { ...c[item.id], disposition: d },
                                  }))
                                }
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.category === "研发路径" && mine && (
                        <div className="convo-field">
                          <div className="convo-chips">
                            {["复用", "适配", "定制", "第三方"].map((d) => (
                              <button
                                key={d}
                                className={
                                  (choices[item.id]?.implementation ||
                                    r.implementation) === d
                                    ? "active"
                                    : ""
                                }
                                onClick={() =>
                                  setChoices((c) => ({
                                    ...c,
                                    [item.id]: { ...c[item.id], implementation: d },
                                  }))
                                }
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                          <textarea
                            rows={2}
                            placeholder="成本比较依据（工时/许可/交付约束）"
                            value={choices[item.id]?.costBasis ?? r.costBasis ?? ""}
                            onChange={(e) =>
                              setChoices((c) => ({
                                ...c,
                                [item.id]: { ...c[item.id], costBasis: e.target.value },
                              }))
                            }
                          />
                        </div>
                      )}
                      {drawer === "judgement" && item.blocker && (
                        <div className="convo-field">
                          <label>答复结论（{item.blocker}）</label>
                          <textarea
                            rows={2}
                            value={choices[item.id]?.resolution ?? r.resolution}
                            onChange={(e) =>
                              setChoices((c) => ({
                                ...c,
                                [item.id]: { ...c[item.id], resolution: e.target.value },
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {drawer !== "bid" && (
                <div className="convo-field">
                  <label>你的意见（通过可不填；驳回必填）</label>
                  <input value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>
              )}
              {notice && <p className="convo-notice">{notice}</p>}
            </div>

            <footer>
              {drawer === "judgement" ? (
                <button className="btn primary" onClick={confirmJudgement}>
                  <Check size={14} />确认答复与判定
                </button>
              ) : drawer === "bid" ? (
                <button className="btn primary" disabled={artifactDone("bid")} onClick={finalWrite}>
                  <Check size={14} />终审通过并写回
                </button>
              ) : (
                <button className="btn primary" onClick={() => approveArtifact(drawer)}>
                  <Check size={14} />通过
                </button>
              )}
              {drawer !== "bid" && drawer !== "judgement" && (
                <button className="btn secondary danger" onClick={() => rejectArtifact(drawer)}>
                  <X size={14} />驳回重做
                </button>
              )}
            </footer>
          </aside>
        </>
      )}
    </section>
  );
}
