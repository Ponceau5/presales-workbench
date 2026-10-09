import { useEffect, useRef, useState } from "react";
import { ArrowRight, Send } from "lucide-react";
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
  "这页有哪些明确的软件要求？",
  "哪些表述需要向客户澄清？",
  "哪些要求需要研发确认？",
];

export function SoftwareAgentPanel({
  documentId, documentTitle, version, page, pageCount, model,
  candidateCount, onExtract, onReview, extracting, canExtract,
}: Props) {
  const [question, setQuestion] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [source, setSource] = useState("");
  const [highlight, setHighlight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!documentId || page < 1 || page > pageCount) return;
    let active = true;
    Promise.all([
      localApi<{ text: string }>(`/api/documents/${documentId}/pages/${page}`),
      localApi<Question[]>(`/api/documents/${documentId}/questions?page=${page}`),
    ]).then(([loadedSource, loadedQuestions]) => {
      if (!active) return;
      setSource(loadedSource.text);
      setQuestions(loadedQuestions);
      setHighlight("");
      setError("");
    }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [documentId, page, pageCount]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [questions]);

  async function ask(value = question) {
    const text = value.trim();
    if (!text || busy || !model?.configured || !documentId) return;
    setBusy(true);
    setError("");
    try {
      const answer = await localApi<Question>(`/api/documents/${documentId}/ask`, {
        method: "POST", body: JSON.stringify({ page, question: text }),
      });
      setQuestions((current) => [...current, answer]);
      setQuestion("");
      setHighlight(answer.quotes[0] || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提问失败");
    } finally {
      setBusy(false);
    }
  }

  const quoteIndex = highlight ? source.indexOf(highlight) : -1;
  return (
    <div className="software-agent-layout">
      <div className="software-agent-conversation">
        <div className="software-agent-conversation-head">
          <div>
            <h4>询问 Agent</h4>
            <span>{model?.configured ? `${model.provider === "deepseek" ? "DeepSeek" : "Kimi"} · ${model.model}` : "模型尚未连接"}</span>
          </div>
          <span>{documentTitle} · {version} · 第 {page} / {pageCount} 页</span>
        </div>
        <div className="software-agent-messages" aria-live="polite">
          {!questions.length && <div className="software-agent-start">
            <h3>先问这页原文</h3>
            <p>Agent 只读取当前页；回答中的引用可定位到右侧原文。</p>
            <div>{suggestions.map((text) => <button key={text} type="button" onClick={() => void ask(text)} disabled={!model?.configured || busy}>{text}</button>)}</div>
          </div>}
          {questions.map((item) => <div className="software-agent-exchange" key={item.id}>
            <p className="software-agent-user">{item.question}</p>
            <div className="software-agent-answer">
              <p>{item.answer}</p>
              {item.quotes.length > 0 && <div className="software-agent-citations">
                {item.quotes.map((quote, index) => <button key={`${item.id}-${index}`} type="button" onClick={() => setHighlight(quote)}>
                  原文 {index + 1} · {quote.length > 90 ? `${quote.slice(0, 90)}…` : quote}
                </button>)}
              </div>}
              {item.follow_up && <small>待核对：{item.follow_up}</small>}
              <span>{item.model} · {item.actor} · {new Date(item.created_at).toLocaleString("zh-CN")}</span>
            </div>
          </div>)}
          <div ref={bottom} />
        </div>
        <div className="software-agent-composer">
          {error && <p role="alert">{error}</p>}
          {!model?.configured && <p>在本机 API 配置 DeepSeek 或 Kimi Key 后即可提问；仍可使用关键词提取与人工核对。</p>}
          <div>
            <textarea aria-label="向 Agent 提问" value={question} placeholder="问这页要求、歧义或需要谁确认…" rows={2}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} />
            <button type="button" aria-label="发送问题" onClick={() => void ask()} disabled={!question.trim() || !model?.configured || busy}><Send size={17} /></button>
          </div>
          <div className="software-agent-actions">
            <span>问答不会修改工件；候选要求仍需人工核对。</span>
            <button type="button" className="btn secondary" onClick={() => void onExtract()} disabled={!canExtract || extracting}>{extracting ? "提取中" : "提取本页要求"}</button>
            <button type="button" className="btn primary" onClick={onReview}>核对清单 {candidateCount}<ArrowRight size={14} /></button>
          </div>
        </div>
      </div>
      <aside className="software-agent-source">
        <header><strong>来源原文</strong><span>{documentTitle} · {version} · 第 {page} 页</span></header>
        <pre>{quoteIndex >= 0 ? <>{source.slice(0, quoteIndex)}<mark>{highlight}</mark>{source.slice(quoteIndex + highlight.length)}</> : source || "此页无可读取文本"}</pre>
      </aside>
    </div>
  );
}
