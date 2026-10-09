import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Send, Sparkles, X } from "lucide-react";
import { localApi } from "@/lib/localApi";
import "./software-agent.css";

type Question = {
  id: string;
  actor: string;
  question: string;
  answer: string;
  quotes: string[];
  follow_up: string;
  model: string;
  provider: string;
  created_at: string;
};

type Props = {
  documentId: string;
  documentTitle: string;
  version: string;
  page: number;
  pageCount: number;
  model: { configured: boolean; provider: string; model: string } | null;
  candidateCount: number;
  onExtract: () => Promise<void>;
  onReview: () => void;
  extracting: boolean;
  canExtract: boolean;
};

const suggestions = [
  "这页有哪些软件要求？",
  "哪些表述需要向客户澄清？",
  "哪些内容需要研发确认？",
];

export function SoftwareAgentPanel({
  documentId, documentTitle, version, page, pageCount, model,
  candidateCount, onExtract, onReview, extracting, canExtract,
}: Props) {
  const [question, setQuestion] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [source, setSource] = useState("");
  const [highlight, setHighlight] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const markedSource = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!documentId || page < 1 || page > pageCount) return;
    let active = true;
    Promise.all([
      localApi<{ text: string }>(`/api/documents/${documentId}/pages/${page}`),
      localApi<Question[]>(`/api/documents/${documentId}/questions?page=${page}`),
    ]).then(([loadedSource, history]) => {
      if (!active) return;
      setSource(loadedSource.text);
      setQuestions(history);
      setHighlight("");
      setSourceOpen(false);
      setError("");
    }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [documentId, page, pageCount]);

  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [questions, pendingQuestion]);
  useEffect(() => { if (sourceOpen && highlight) markedSource.current?.scrollIntoView({ block: "center" }); }, [sourceOpen, highlight]);

  async function ask(value = question) {
    const text = value.trim();
    if (!text || pendingQuestion || !documentId) return;
    setPendingQuestion(text);
    setQuestion("");
    setError("");
    try {
      const answer = await localApi<Question>(`/api/documents/${documentId}/ask`, {
        method: "POST", body: JSON.stringify({ page, question: text }),
      });
      setQuestions((current) => [...current, answer]);
    } catch (reason) {
      setQuestion(text);
      setError(reason instanceof Error ? reason.message : "提问失败");
    } finally {
      setPendingQuestion("");
    }
  }

  function showSource(quote = "") {
    setHighlight(quote);
    setSourceOpen(true);
  }

  const quoteIndex = highlight ? source.indexOf(highlight) : -1;
  const agentName = model?.configured
    ? `${model.provider === "deepseek" ? "DeepSeek" : "Kimi"} · ${model.model}`
    : "本地来源检索";

  return (
    <div className="software-agent-layout">
      <div className="software-agent-conversation">
        <header className="software-agent-conversation-head">
          <div className="software-agent-identity"><span className="software-agent-mark"><Sparkles size={16} /></span><div><strong>软件 Agent</strong><small>{agentName}</small></div></div>
          <button type="button" className="software-agent-source-link" onClick={() => showSource()}><FileText size={15} />原文 · 第 {page} 页</button>
        </header>

        <div className="software-agent-messages" aria-live="polite">
          <div className="software-agent-thread">
            <div className="software-agent-intro">
              <span className="software-agent-mark"><Sparkles size={17} /></span>
              <div>
                <strong>已载入 {documentTitle}</strong>
                <p>{version} · 第 {page} / {pageCount} 页。问我要求、歧义或需要谁确认；点击回答中的原文可核对上下文。</p>
                {!model?.configured && <small>当前使用本地原文检索；不生成软件应答结论。</small>}
              </div>
            </div>
            {!questions.length && !pendingQuestion && <div className="software-agent-prompts">
              {suggestions.map((prompt) => <button type="button" key={prompt} onClick={() => void ask(prompt)}>{prompt}<ArrowRight size={14} /></button>)}
            </div>}
            {questions.map((item) => <div className="software-agent-exchange" key={item.id}>
              <div className="software-agent-user">{item.question}</div>
              <article className="software-agent-answer">
                <div className="software-agent-answer-meta"><span className="software-agent-mark"><Sparkles size={13} /></span><strong>Agent</strong><span>{item.model}</span></div>
                <p>{item.answer}</p>
                {item.quotes.length > 0 && <div className="software-agent-citations">
                  <strong>原文依据</strong>
                  {item.quotes.map((quote, index) => <button key={`${item.id}-${index}`} type="button" onClick={() => showSource(quote)}>
                    <span>第 {page} 页 · 引用 {index + 1}</span><span>{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}</span><ArrowRight size={14} />
                  </button>)}
                </div>}
                {item.follow_up && <div className="software-agent-next"><span>待你处理</span>{item.follow_up}</div>}
                <div className="software-agent-result-actions">
                  <button type="button" onClick={onReview}>打开核对清单 <ArrowRight size={14} /></button>
                  <span>{new Date(item.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </article>
            </div>)}
            {pendingQuestion && <div className="software-agent-exchange">
              <div className="software-agent-user">{pendingQuestion}</div>
              <div className="software-agent-working"><span className="software-agent-pulse" />正在读取第 {page} 页原文…</div>
            </div>}
            <div ref={end} />
          </div>
        </div>

        <div className="software-agent-composer">
          {error && <p role="alert">{error}</p>}
          <div className="software-agent-input">
            <textarea aria-label="向 Agent 提问" value={question} placeholder="问这页资料，例如：告警回溯视频的范围写清楚了吗？" rows={2}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} />
            <button type="button" aria-label="发送问题" onClick={() => void ask()} disabled={!question.trim() || !!pendingQuestion}><Send size={17} /></button>
          </div>
          <div className="software-agent-composer-actions">
            <span>{documentTitle} · {version} · 第 {page} 页</span>
            <button type="button" onClick={() => void onExtract()} disabled={!canExtract || extracting}>{extracting ? "生成中…" : model?.configured ? "提取本页要求" : "生成关键词候选"}</button>
            <button type="button" onClick={onReview}>核对清单 {candidateCount}<ArrowRight size={14} /></button>
          </div>
        </div>
      </div>
      {sourceOpen && <aside className="software-agent-source" aria-label="来源原文">
        <header><div><strong>{documentTitle}</strong><span>{version} · 第 {page} 页</span></div><button type="button" aria-label="关闭原文" onClick={() => setSourceOpen(false)}><X size={17} /></button></header>
        <pre>{quoteIndex >= 0 ? <>{source.slice(0, quoteIndex)}<mark ref={markedSource}>{highlight}</mark>{source.slice(quoteIndex + highlight.length)}</> : source || "此页无可读取文本"}</pre>
      </aside>}
    </div>
  );
}
