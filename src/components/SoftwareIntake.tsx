import { useState } from "react";
import { DocumentReader } from "@/components/SourceReader";
import type {
  ReferenceItem,
  ReferenceReviewState,
} from "@/lib/referenceReview";
import { referenceAction } from "@/lib/referenceReview";
import { reviewKey } from "@/lib/projectReview";
import { useWorkbench } from "@/state/workbench";

export function SoftwareIntake({
  projectId,
  items,
  review,
  onChange,
  onContinue,
}: {
  projectId: string;
  items: ReferenceItem[];
  review: ReferenceReviewState;
  onChange: (value: ReferenceReviewState) => void;
  onContinue: (id?: string) => void;
}) {
  const { state, dispatch } = useWorkbench();
  const roots = items.filter((i) => i.category === "客户应答");
  const [doc, setDoc] = useState<"bms-spec" | "dcom-requirements">("bms-spec");
  const [selected, setSelected] = useState(roots[0].id);
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [correction, setCorrection] = useState<string | null>(null);
  const [error, setError] = useState("");
  const item = items.find((i) => i.id === selected)!;
  const extracted = review.rows[selected].extraction;
  const candidates = roots.filter((i) => review.rows[i.id].extraction);
  const confirmed = candidates.filter(
    (i) => review.rows[i.id].extraction?.status === "confirmed",
  );
  const executionLog = log.length
    ? log
    : extracted
      ? [
          "来源：" + extracted.source,
          "运行：" + extracted.runId.slice(0, 8),
          "执行时间：" + new Date(extracted.at).toLocaleString("zh-CN"),
          "核对：" + (extracted.reviewer || "尚未核对"),
        ]
      : [];
  const commit = (next: ReferenceReviewState, id: string, action: string) => {
    localStorage.setItem(reviewKey(projectId), JSON.stringify(next));
    dispatch({
      type: "referenceAudit",
      projectId,
      id,
      action,
      before: JSON.stringify(review.rows[id]),
      after: JSON.stringify(next.rows[id]),
    });
    onChange(next);
    window.dispatchEvent(new Event("presales-reference-change"));
  };
  async function extract() {
    setRunning(true);
    setError("");
    setLog([]);
    try {
      let input = "演示规格书 V6";
      if (projectId === "RCJM1") {
        const response = await fetch(`/project-data/rcjm1/${doc}.json`);
        if (!response.ok) throw new Error("原文读取失败，未生成要求");
        const source = await response.json();
        input =
          doc === "bms-spec"
            ? `BMS Spec · ${source.pages?.length || 0} 页`
            : `DCOM 需求分析 v2 · ${source.paragraphs?.length || 0} 段`;
      }
      const runId = crypto.randomUUID();
      const at = new Date().toISOString();
      let next = review;
      const rows = roots.filter(
        (i) => projectId !== "RCJM1" || i.document === doc,
      );
      for (const i of rows)
        next = referenceAction(
          next,
          i.id,
          "extract",
          state.role,
          {
            extraction: {
              runId,
              at,
              source: i.source,
              requirement: i.requirement,
              status: "candidate",
            },
          },
          state.accountId || undefined,
          items,
        );
      if (next === review) throw new Error("由软件产品账号执行提取与核对");
      localStorage.setItem(reviewKey(projectId), JSON.stringify(next));
      for (const i of rows)
        dispatch({
          type: "referenceAudit",
          projectId,
          id: i.id,
          action: "extract",
          before: JSON.stringify(review.rows[i.id]),
          after: JSON.stringify(next.rows[i.id]),
        });
      onChange(next);
      setSelected(rows[0].id);
      setCorrection(null);
      setPhase(2);
      setLog([
        `读取：${input}`,
        `执行：Mock 提取 · ${new Date(at).toLocaleString("zh-CN")}`,
        `生成：${rows.length} 条候选要求，尚未核对`,
        `运行：${runId.slice(0, 8)}`,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提取失败");
    } finally {
      setRunning(false);
    }
  }
  return (
    <section className="software-intake">
      <nav className="intake-flow" aria-label="软件处理流程">
        {["原始资料", "Agent 提取", "人工核对", "专业确认与应答"].map(
          (title, index) => (
            <button
              key={title}
              className={phase === index ? "active" : ""}
              onClick={() =>
                index === 3 ? onContinue(selected) : setPhase(index)
              }
            >
              <b>{index + 1}</b>
              <span>{title}</span>
              {index === 2 && (
                <small>
                  {confirmed.length}/{candidates.length}
                </small>
              )}
            </button>
          ),
        )}
      </nav>
      <div className="intake-toolbar">
        <select
          aria-label="提取来源文件"
          value={doc}
          onChange={(e) => {
            setDoc(e.target.value as typeof doc);
            setPhase(0);
          }}
        >
          <option value="bms-spec">
            {projectId === "RCJM1"
              ? "BMS Technical Specification"
              : "演示规格书 V6"}
          </option>
          {projectId === "RCJM1" && (
            <option value="dcom-requirements">RC DCOM 需求分析 v2</option>
          )}
        </select>
        <span>Mock · 预置提取样例</span>
        <button
          className="btn primary"
          disabled={running || state.role !== "软件产品"}
          onClick={() => void extract()}
        >
          {running
            ? "读取中…"
            : candidates.some((i) => i.document === doc)
              ? "重新提取"
              : "读取并提取要求"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {executionLog.length > 0 && (
        <details className="intake-run" open={phase === 1}>
          <summary>执行记录</summary>
          {executionLog.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </details>
      )}
      <div className="intake-compare">
        <section>
          <header>
            <h3>原始文件</h3>
            <span>
              {phase === 2
                ? item.source
                : doc === "bms-spec"
                  ? "BMS Technical Specification"
                  : "DCOM 需求分析 v2"}
            </span>
          </header>
          {projectId === "RCJM1" ? (
            <DocumentReader
              key={
                (phase === 2 ? item.document : doc) +
                (phase === 2 ? item.page : 1)
              }
              document={phase === 2 ? item.document : doc}
              initialPage={phase === 2 ? item.page : 1}
              focusTerm={
                phase === 2 && item.document === "bms-spec"
                  ? /OPC/.test(item.title)
                    ? "OPC"
                    : /历史/.test(item.title)
                      ? "histor"
                      : /浏览器/.test(item.title)
                        ? "browser"
                        : undefined
                  : undefined
              }
              initialParagraph={
                phase === 2
                  ? Number(item.source.match(/¶(\d+)/)?.[1]) || undefined
                  : undefined
              }
            />
          ) : (
            <div className="intake-demo-source">
              {roots.map((i) => (
                <article key={i.id}>
                  <strong>{i.source}</strong>
                  <p>{i.requirement}</p>
                </article>
              ))}
            </div>
          )}
        </section>
        <section>
          <header>
            <h3>提取要求</h3>
            <span>
              {candidates.length} 候选 · {confirmed.length} 已核对
            </span>
          </header>
          {!candidates.length ? (
            <div className="intake-empty">
              <h4>尚未执行提取</h4>
              <p>选定来源文件，执行提取后，在这里逐条对照原文。</p>
            </div>
          ) : (
            <>
              <div className="intake-queue">
                {candidates.map((i) => (
                  <button
                    key={i.id}
                    className={selected === i.id ? "active" : ""}
                    onClick={() => {
                      setSelected(i.id);
                      setCorrection(null);
                      setPhase(2);
                    }}
                  >
                    <strong>{i.title}</strong>
                    <span>
                      {review.rows[i.id].extraction?.status === "confirmed"
                        ? "已核对"
                        : "待核对"}
                    </span>
                  </button>
                ))}
              </div>
              {extracted && (
                <div className="intake-review">
                  <h4>{item.title}</h4>
                  <p className="intake-provenance">
                    {extracted.source} ·{" "}
                    {new Date(extracted.at).toLocaleString("zh-CN")} ·{" "}
                    {extracted.reviewer || "Agent 候选"}
                  </p>
                  <label className="form-label">
                    提取后的要求
                    <textarea
                      rows={5}
                      value={correction ?? extracted.requirement}
                      readOnly={state.role !== "软件产品"}
                      onChange={(e) => setCorrection(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="btn primary"
                      disabled={
                        state.role !== "软件产品" ||
                        !(correction ?? extracted.requirement).trim()
                      }
                      onClick={() => {
                        const next = referenceAction(
                          review,
                          selected,
                          "verify",
                          state.role,
                          {
                            extraction: {
                              ...extracted,
                              requirement: correction ?? extracted.requirement,
                            },
                          },
                          state.accountId || undefined,
                          items,
                        );
                        commit(next, selected, "verify");
                        setCorrection(null);
                      }}
                    >
                      确认提取内容
                    </button>
                    <button
                      className="btn secondary"
                      disabled={extracted.status !== "confirmed"}
                      onClick={() => onContinue(selected)}
                    >
                      进入专业判断
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
