import { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "@/state/workbench";
import { localApi, localApiReady } from "@/lib/localApi";
import type { ProjectProgress } from "@/lib/projectProgress";
import { useSearchParams } from "react-router";

type Document = { id: string; title: string; version: string; filename: string; created_at: string; page_count: number };
type Requirement = {
  id: string; document_id: string; page: number; quote: string; text: string;
  status: string; revision: number; source_version: string; source_title: string;
  disposition: string | null; customer_answer: string | null;
  extractor: "mock" | "kimi"; extraction_run_id: string | null;
};
type Handoff = {
  id: string; project_id: string; requirement_id: string; owner: string;
  question: string; answer: string | null; status: string; outdated: number;
};
type Fact = { id: string; quote: string; answer: string; disposition: string; source_title: string; source_version: string; published_by: string; published_at: string };
type Event = { id: string; actor: string; action: string; detail: string; created_at: string };

const recipients = [
  ["sales", "销售澄清"],
  ["dev", "研发意见"],
  ["solution", "解决方案意见"],
] as const;
const statusLabel: Record<string, string> = {
  candidate: "待核对", verified: "已核对", approved: "应答已批准",
  published: "已写回", rejected: "已驳回", stale: "版本失效",
};

export function LocalSourceReview({ projectId }: { projectId: string }) {
  const { state } = useWorkbench();
  const [params] = useSearchParams();
  const requestedRequirement = params.get("requirement");
  const account = state.accountId;
  const connected = localApiReady(account);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [model, setModel] = useState<{ configured: boolean; model: string } | null>(null);
  const [selectedDocument, setSelectedDocument] = useState("");
  const [selectedRequirement, setSelectedRequirement] = useState(requestedRequirement || "");
  const [selectedPage, setSelectedPage] = useState(1);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState(projectId === "RCJM1" ? "Rack Central · BMS Technical Specification" : "项目来源文件");
  const [version, setVersion] = useState("V1");
  const [file, setFile] = useState<File | null>(null);
  const [requirementText, setRequirementText] = useState("");
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState("sales");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [disposition, setDisposition] = useState("");
  const [customerAnswer, setCustomerAnswer] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [docs, rows, transfers, published, history, nextProgress, modelStatus] = await Promise.all([
      localApi<Document[]>(`/api/projects/${projectId}/documents`),
      localApi<Requirement[]>(`/api/projects/${projectId}/requirements`),
      localApi<Handoff[]>(`/api/projects/${projectId}/handoffs`),
      localApi<Fact[]>(`/api/projects/${projectId}/facts`),
      localApi<Event[]>(`/api/projects/${projectId}/events`),
      localApi<ProjectProgress>(`/api/projects/${projectId}/progress`),
      localApi<{ configured: boolean; model: string }>("/api/model/status"),
    ]);
    setDocuments(docs);
    setRequirements(rows);
    setHandoffs(transfers);
    setFacts(published);
    setEvents(history);
    setProgress(nextProgress);
    setModel(modelStatus);
    setSelectedDocument((current) => current || rows.find((row) => row.id === requestedRequirement)?.document_id || docs[0]?.id || "");
    setSelectedRequirement((current) => current || rows[0]?.id || "");
  }, [projectId, requestedRequirement]);
  useEffect(() => {
    if (!connected) return;
    queueMicrotask(() => void refresh().catch((error: Error) => setMessage(error.message)));
  }, [connected, refresh]);

  const visibleRows = requirements.filter((row) => row.document_id === selectedDocument);
  const queueRows = visibleRows.filter((row) =>
    (statusFilter === "all" || row.status === statusFilter) &&
    `${row.quote} ${row.text} ${row.page}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const current = queueRows.find((row) => row.id === selectedRequirement) || queueRows[0];
  const related = handoffs.filter((item) => item.requirement_id === current?.id && !item.outdated);
  const inbox = handoffs.filter((item) => item.owner === account && !item.outdated);
  const demoImported = documents.some((item) => item.title === "Rack Central · BMS Technical Specification");
  const selectedSource = documents.find((item) => item.id === selectedDocument);
  function narrowQueue(nextQuery: string, nextStatus: string) {
    setQuery(nextQuery);
    setStatusFilter(nextStatus);
    const filtered = visibleRows.filter((row) =>
      (nextStatus === "all" || row.status === nextStatus) &&
      `${row.quote} ${row.text} ${row.page}`.toLowerCase().includes(nextQuery.trim().toLowerCase()),
    );
    if (!filtered.some((row) => row.id === selectedRequirement))
      setSelectedRequirement(filtered[0]?.id || "");
  }
  useEffect(() => {
    if (!current || !connected) return;
    let active = true;
    queueMicrotask(() => setSelectedPage(current.page));
    void localApi<{ text: string }>(`/api/documents/${current.document_id}/pages/${current.page}`)
      .then((page) => {
        if (!active) return;
        setSource(page.text);
        setRequirementText(current.text);
        setDisposition(current.disposition || "");
        setCustomerAnswer(current.customer_answer || "");
      })
      .catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [current, connected]);

  async function act(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const json = (value: unknown) => ({ method: "POST", body: JSON.stringify(value) });

  if (!connected) return (
    <section className="local-review local-review-empty">
      <h3>本机资料核对</h3>
      <p>启动本机协作 API 后重新登录，即可上传原始文件，并跨账号处理来源核对、交接与应答。当前浏览器演示仍可使用。</p>
    </section>
  );

  return (
    <section className="local-review">
      <header className="local-review-header">
        <h3>来源与要求</h3>
        <span>{documents.length} 份文件 · {requirements.length} 条要求 · {inbox.filter((i) => i.status === "pending").length} 项待答复</span>
        <button className="btn secondary" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </header>
      {message && <p className="local-review-message" role="status">{message}</p>}
      {progress && <div className="local-review-progress" aria-label="F5 服务端进度">
        <strong>{progress.status}</strong>
        <span>{progress.next_action}</span>
        <div>
          <span>来源 {progress.document_count}</span>
          <span>待核对 {progress.counts.candidate}</span>
          <span>待答复 {progress.pending_handoffs}</span>
          <span>待写回 {progress.counts.approved}</span>
          <span>已写回 {progress.counts.published}</span>
          {progress.stale_count > 0 && <span>版本失效 {progress.stale_count}</span>}
        </div>
        {progress.last_run && <small>最近执行：{progress.last_run.model} · 第 {progress.last_run.pages} 页 · {progress.last_run.status === "completed" ? `原文匹配 ${progress.last_run.candidate_count} 条，跳过 ${progress.last_run.skipped_count} 条` : progress.last_run.error || "处理中"}</small>}
      </div>}
      {projectId === "RCJM1" && !demoImported && (account === "sales" || account === "software" || account === "pm") && (
        <div className="local-review-demo-import">
          <span>Rack Central · BMS Technical Specification</span>
          <button className="btn secondary" disabled={busy} onClick={() => void act(async () => {
            const imported = await localApi<{ id: string; already_imported: boolean }>(`/api/projects/${projectId}/demo-source`, { method: "POST" });
            setSelectedDocument(imported.id);
            setSelectedRequirement("");
          }, "本机 BMS 原件已入库，可执行候选提取")}>导入本机 BMS 原件</button>
        </div>
      )}
      {(account === "sales" || account === "software" || account === "pm") && (
        <form className="local-review-upload" onSubmit={(event) => {
          event.preventDefault();
          if (!file) return;
          const form = new FormData();
          form.set("title", title); form.set("version", version); form.set("file", file);
          void act(async () => {
            const saved = await localApi<{ id: string }>(`/api/projects/${projectId}/documents`, { method: "POST", body: form });
            setSelectedDocument(saved.id);
            setSelectedRequirement("");
          }, "文件已入库；新版本变更会使不再匹配原文的要求失效");
        }}>
          <strong>加入来源文件</strong>
          <input aria-label="文件标题" value={title} onChange={(event) => setTitle(event.target.value)} required />
          <input aria-label="文件版本" value={version} onChange={(event) => setVersion(event.target.value)} required />
          <input aria-label="选择原始文件" type="file" accept=".pdf,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] || null)} required />
          <button className="btn secondary" type="submit" disabled={busy || !file}>上传</button>
        </form>
      )}
      {inbox.length > 0 && account !== "software" && (
        <section className="local-review-inbox">
          <h4>交给我的问题</h4>
          {inbox.map((item) => (
            <div key={item.id}>
              <strong>{item.status === "answered" ? "已答复" : "待答复"}</strong>
              <p>{item.question}</p>
              {item.status === "pending" ? <>
                <textarea aria-label="交接答复" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={2} />
                <button className="btn primary" disabled={busy || answer.trim().length < 3} onClick={() => void act(() => localApi(`/api/handoffs/${item.id}/reply`, json({ answer })), "答复已提交给软件产品复核")}>提交答复</button>
              </> : <p>{item.answer}</p>}
            </div>
          ))}
        </section>
      )}
      <div className="local-review-toolbar">
        <select aria-label="来源版本" value={selectedDocument} onChange={(event) => { setSelectedDocument(event.target.value); setSelectedRequirement(""); setQuery(""); setStatusFilter("all"); }}>
          <option value="">选择来源文件</option>
          {documents.map((doc) => <option value={doc.id} key={doc.id}>{doc.title} · {doc.version} · {doc.filename}</option>)}
        </select>
        {selectedDocument && account === "software" && <>
          <label className="local-review-page">页码 <input aria-label="模型提取页码" type="number" min={1} max={selectedSource?.page_count || undefined} value={selectedPage} onChange={(event) => setSelectedPage(Number(event.target.value))} /></label>
          <button className="btn primary" disabled={busy || !model?.configured || selectedPage < 1 || selectedPage > (selectedSource?.page_count || 0) || visibleRows.some((row) => row.page === selectedPage && row.status !== "candidate")} onClick={() => void act(async () => {
            const result = await localApi<{ candidate_count: number; skipped_count: number }>(`/api/documents/${selectedDocument}/extract-live`, json({ pages: [selectedPage] }));
            setSelectedRequirement("");
            return result;
          }, `Kimi 已提取第 ${selectedPage} 页候选；请对照原文逐条核对`)}>Kimi 提取选定页</button>
          <button className="btn secondary" disabled={busy || visibleRows.some((row) => row.status !== "candidate")} onClick={() => void act(() => localApi(`/api/documents/${selectedDocument}/extract${visibleRows.length ? "?force=true" : ""}`, { method: "POST" }), "已生成关键词候选；请逐条对照原文核对")}>关键词提取</button>
        </>}
        {selectedDocument && account === "software" && <small>{model?.configured ? `${model.model} · 每次仅处理选定页` : "Kimi 未配置：管理员需在服务端设置 MOONSHOT_API_KEY"}</small>}
      </div>
      <div className="local-review-grid">
        <nav aria-label="来源要求队列" className="local-review-queue">
          <div className="local-review-queue-tools">
            <input aria-label="搜索候选要求" placeholder="搜索原文 / 页码" value={query} onChange={(event) => narrowQueue(event.target.value, statusFilter)} />
            <select aria-label="筛选处理状态" value={statusFilter} onChange={(event) => narrowQueue(query, event.target.value)}>
              <option value="all">全部 {visibleRows.length}</option>
              {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label} {visibleRows.filter((row) => row.status === value).length}</option>)}
            </select>
          </div>
          {queueRows.map((row) => <button className={row.id === current?.id ? "selected" : ""} key={row.id} onClick={() => setSelectedRequirement(row.id)}>
            <span>第 {row.page} 页 · {statusLabel[row.status] || row.status} · {row.extractor === "kimi" ? "Kimi" : "关键词"}</span>
            <strong>{row.quote}</strong>
          </button>)}
          {!visibleRows.length && <p>此版本尚无候选。上传并执行提取后，可在这里逐条核对。</p>}
          {visibleRows.length > 0 && !queueRows.length && <p>没有匹配的要求。</p>}
        </nav>
        <section className="local-review-source">
          <h4>来源原文 {current ? `· 第 ${current.page} 页` : ""}</h4>
          {current ? <><blockquote>{current.quote}</blockquote><pre>{source}</pre></> : <p>选择一条候选要求查看原文。</p>}
        </section>
        <section className="local-review-actions">
          <h4>人工处理</h4>
          {current ? <>
            <p>来源：{current.source_title} · {current.source_version} · 修订 {current.revision}</p>
            <p>提取：{current.extractor === "kimi" ? `Kimi · 运行 ${current.extraction_run_id?.slice(0, 8)}` : "关键词"}；候选必须核对原文后才能进入判断。</p>
            <label>核对后的要求<textarea rows={4} value={requirementText} readOnly={account !== "software"} onChange={(event) => setRequirementText(event.target.value)} /></label>
            {account === "software" && <>
              <label>处理说明<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明核对依据或判断" /></label>
              <button className="btn secondary" disabled={busy || note.trim().length < 3 || requirementText.trim().length < 3 || current.status === "stale"} onClick={() => void act(() => localApi(`/api/requirements/${current.id}/verify`, json({ expected_revision: current.revision, requirement: requirementText, note })), "原文要求已核对")}>确认原文要求</button>
              {(current.status === "verified" || current.status === "rejected") && <>
                <div className="local-review-handoff">
                  <select aria-label="交接岗位" value={owner} onChange={(event) => setOwner(event.target.value)}>{recipients.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                  <input aria-label="交接问题" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="向接收岗位确认什么？" />
                  <button className="btn secondary" disabled={busy || question.trim().length < 3} onClick={() => void act(() => localApi(`/api/requirements/${current.id}/handoffs`, json({ owner, question })), "问题已派给接收岗位")}>派发</button>
                </div>
                <label>客户应答<textarea rows={3} value={customerAnswer} onChange={(event) => setCustomerAnswer(event.target.value)} /></label>
                <label>判定<input value={disposition} onChange={(event) => setDisposition(event.target.value)} placeholder="满足 / 待澄清 / 不满足" /></label>
                <div className="local-review-buttons">
                  <button className="btn secondary" disabled={busy || note.trim().length < 3} onClick={() => void act(() => localApi(`/api/requirements/${current.id}/decision`, json({ expected_revision: current.revision, action: "reject", note })), "已驳回；可修改后重新核对")}>驳回</button>
                  <button className="btn primary" disabled={busy || note.trim().length < 3 || !customerAnswer.trim() || !disposition.trim()} onClick={() => void act(() => localApi(`/api/requirements/${current.id}/decision`, json({ expected_revision: current.revision, action: "approve", disposition, customer_answer: customerAnswer, note })), "客户版应答已由软件产品批准")}>批准应答</button>
                </div>
              </>}
              {current.status === "approved" && <button className="btn primary" disabled={busy} onClick={() => void act(() => localApi(`/api/requirements/${current.id}/publish`, json({ expected_revision: current.revision })), "应答已写回项目事实")}>写回项目事实</button>}
            </>}
            {related.length > 0 && <div className="local-review-replies"><h5>关联岗位答复</h5>{related.map((item) => <p key={item.id}><strong>{recipients.find(([id]) => id === item.owner)?.[1]} · {item.status}</strong><br />{item.question}<br />{item.answer || "等待答复"}</p>)}</div>}
          </> : <p>选择候选后核对；客户应答需软件产品批准。</p>}
        </section>
      </div>
      <details className="local-review-history">
        <summary>已写回事实 {facts.length} · 操作记录 {events.length}</summary>
        <div className="local-review-history-grid">
          <section><h4>项目事实</h4>{facts.map((fact) => <article key={fact.id}><strong>{fact.source_title} · {fact.source_version}</strong><p>{fact.quote}</p><p>{fact.disposition}：{fact.answer}</p><small>{fact.published_by} · {new Date(fact.published_at).toLocaleString("zh-CN")}</small></article>)}</section>
          <section><h4>操作记录</h4>{events.slice(0, 30).map((event) => <article key={event.id}><strong>{event.actor} · {event.action}</strong><p>{event.detail}</p><small>{new Date(event.created_at).toLocaleString("zh-CN")}</small></article>)}</section>
        </div>
      </details>
    </section>
  );
}
