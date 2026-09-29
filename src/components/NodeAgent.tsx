import { acceptedInputs } from "@/lib/collaboration";
import { readProjectReview } from "@/lib/projectReview";
import { roles } from "@/lib/workspace";
import { useState } from "react";
import { ArrowUp, Bot, MessageSquare } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import {
  taskOptions,
  stageArtifact,
  softwareArtifact,
  executeAgentTask,
  inferTask,
  type AgentArtifact,
  type AgentResult,
  type AgentTaskKind,
} from "@/lib/agentTasks";
import { referenceItems } from "@/lib/referenceReview";
import { demoReviewItems } from "@/lib/demoReview";

export function NodeAgent({
  stage,
  projectId,
  artifact: supplied,
  onGenerate,
  onApply,
  applyBlocked = false,
  onSource,
}: {
  stage: string;
  projectId: string;
  artifact?: AgentArtifact;
  onGenerate?: () => void | Promise<void>;
  onApply?: (text: string) => void;
  applyBlocked?: boolean;
  onSource?: () => void;
}) {
  const { state, dispatch } = useWorkbench();
  const items = projectId === "RCJM1" ? referenceItems : demoReviewItems;
  const fallbackItem = items.find((i) => i.owner === state.role) || items[0];
  const baseArtifact =
    supplied ||
    (stage === "F5"
      ? softwareArtifact(fallbackItem, {
          ...readProjectReview(projectId, state).rows[fallbackItem.id],
        })
      : stageArtifact(
          projectId,
          stage,
          0,
          state.currentProjectId === projectId
            ? state.stageStates[stage]?.rows[0].text
            : undefined,
          state.stageStates[stage]?.version,
          state.stageStates[stage]?.response?.text,
        ));
  const workUrl = `/projects/${projectId}?view=review&stage=${stage}${stage === "F5" ? "&item=" + baseArtifact.id : "&row=" + baseArtifact.id.split(":")[1]}`;
  const replies = state.followups
    .filter(
      (f) =>
        f.projectId === projectId &&
        f.url === workUrl &&
        f.status === "done" &&
        f.result,
    )
    .map((f) => `${f.owner}答复：${f.result}；关联来源：${f.source}`);
  const incoming = acceptedInputs(state, projectId, stage);
  const artifact = {
    ...baseArtifact,
    context: [
      baseArtifact.context,
      ...replies,
      ...incoming.map(
        (d) =>
          `${d.fromStage}交接 · ${d.title} ${d.version} · ${d.senderRole}：${d.text}；依据：${d.evidence}`,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  };
  const key = `agent-task-v2:${state.accountId}:${projectId}:${stage}:${artifact.id}`;
  const [result, setResult] = useState<AgentResult | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  });
  const [prompt, setPrompt] = useState("");
  const [includeSource, setIncludeSource] = useState(true);
  const [includeArtifact, setIncludeArtifact] = useState(true);
  const [includeContext, setIncludeContext] = useState(true);
  const [recipient, setRecipient] = useState(artifact.owner);
  const [notice, setNotice] = useState("");
  const sources = [
    ...(includeSource ? [artifact.source] : []),
    ...(includeArtifact ? [`${artifact.title} · R${artifact.revision}`] : []),
    ...(includeContext && artifact.context
      ? ["参数、专业答复与已接收交接"]
      : []),
  ];
  const stale =
    !!result &&
    (JSON.stringify(result.inputSources) !== JSON.stringify(sources) ||
      result.artifactId !== artifact.id ||
      result.revision !== artifact.revision ||
      result.inputText !== artifact.text ||
      result.inputResolution !== (artifact.resolution || "") ||
      result.inputContext !== (includeContext ? artifact.context || "" : ""));
  function run(kind: AgentTaskKind, request: string) {
    const next = executeAgentTask(
      projectId,
      stage,
      { ...artifact, context: includeContext ? artifact.context : undefined },
      kind,
      request,
      sources,
      state.role,
    );
    setRecipient(next.followup?.owner || artifact.owner);
    setResult(next);
    setNotice("");
    setPrompt("");
    sessionStorage.setItem(key, JSON.stringify(next));
    dispatch({
      type: "agentRun",
      projectId,
      id: artifact.id,
      summary: JSON.stringify({ stage, ...next, sources }),
    });
  }
  function talk() {
    window.dispatchEvent(
      new CustomEvent("presales-assistant-open", {
        detail: {
          projectId,
          stage,
          artifact,
          prompt: prompt || `检查「${artifact.title}」的缺项与下一步`,
        },
      }),
    );
  }
  return (
    <section className="artifact-agent">
      <header>
        <div>
          <Bot size={16} />
          <strong>Agent 任务</strong>
          <span>Mock</span>
        </div>
        <button onClick={talk} aria-label={`${stage}工件对话`}>
          <MessageSquare size={15} />
        </button>
      </header>
      <div className="agent-target">
        <strong>{artifact.title}</strong>
        <span>
          {artifact.owner} · R{artifact.revision}
        </span>
      </div>
      <details className="agent-inputs">
        <summary>
          输入范围 ·{" "}
          {
            [
              includeSource,
              includeArtifact,
              includeContext && !!artifact.context,
            ].filter(Boolean).length
          }{" "}
          项
        </summary>
        <label>
          <input
            type="checkbox"
            checked={includeSource}
            onChange={(e) => setIncludeSource(e.target.checked)}
          />
          <span>{artifact.source}</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeArtifact}
            onChange={(e) => setIncludeArtifact(e.target.checked)}
          />
          <span>
            {artifact.title} · R{artifact.revision}
          </span>
        </label>
        {artifact.context && (
          <label>
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
            />
            <span>
              参数、专业答复与已接收交接
              <details>
                <summary>内容</summary>
                <p>{artifact.context}</p>
              </details>
            </span>
          </label>
        )}
      </details>
      {onSource && (
        <button className="agent-source-link" onClick={onSource}>
          查看输入依据
        </button>
      )}
      <div className="agent-task-options">
        {taskOptions(
          stage,
          artifact.category,
          state.role === "PM / PO" ? state.role : artifact.owner,
        ).map((t) => (
          <button key={t.kind} onClick={() => run(t.kind, t.label)}>
            {t.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) run(inferTask(prompt), prompt);
        }}
      >
        <input
          aria-label={`${stage} Agent 指令`}
          placeholder="输入本工件的处理要求"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button disabled={!prompt.trim()} aria-label="发送节点指令">
          <ArrowUp size={15} />
        </button>
      </form>
      {result && !stale && (
        <div className="agent-task-result">
          <h4>{result.label}</h4>
          {result.findings.map((f, n) => (
            <section key={n}>
              <div>
                <strong>{f.title}</strong>
                <span className={f.status === "待确认" ? "warning" : ""}>
                  {f.status}
                </span>
              </div>
              <p>{f.text}</p>
              <small>{f.source}</small>
            </section>
          ))}
          {result.proposal && (
            <details className="agent-proposal" open>
              <summary>候选修改</summary>
              <pre>{result.proposal}</pre>
              {onApply && artifact.owner === state.role && (
                <button
                  className="btn secondary"
                  disabled={applyBlocked || result.proposal === artifact.text}
                  onClick={() => {
                    onApply(result.proposal!);
                    setNotice("已放入编辑区，保存后进入复核。");
                  }}
                >
                  {applyBlocked
                    ? "先保存当前修改"
                    : result.proposal === artifact.text
                      ? "当前内容已一致"
                      : "采用到编辑区"}
                </button>
              )}
            </details>
          )}
          {result.followup && (
            <div className="agent-handoff">
              <label>
                跟进负责人
                <select
                  aria-label="跟进负责人"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                >
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn secondary"
                disabled={state.followups.some(
                  (f) =>
                    f.projectId === projectId &&
                    f.title === result.followup!.title &&
                    f.status !== "done",
                )}
                onClick={() => {
                  dispatch({
                    type: "followup",
                    projectId,
                    title: result.followup!.title,
                    owner: recipient,
                    source: `${artifact.source} · ${artifact.title} R${artifact.revision}`,
                    url: `/projects/${projectId}?view=review&stage=${stage}${stage === "F5" ? "&item=" + (artifact.followupTarget?.owner === recipient ? artifact.followupTarget.id : artifact.id) : "&row=" + artifact.id.split(":")[1]}`,
                  });
                  setNotice(`已交给${recipient}，关联当前工件与依据。`);
                }}
              >
                发起跟进
              </button>
            </div>
          )}
        </div>
      )}
      {result && stale && (
        <p className="agent-task-notice">输入或工件已变化，请重新执行任务。</p>
      )}
      {onGenerate && (
        <button
          className="btn secondary full"
          onClick={() => void onGenerate()}
        >
          建立待审草稿
        </button>
      )}
      {notice && !stale && (
        <p className="agent-task-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
