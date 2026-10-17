import { randomId } from "@/lib/id";
import { type AgentArtifact } from "@/lib/agentTasks";
import { localApi } from "@/lib/localApi";
import { MarkdownReply } from "@/features/software/MarkdownReply";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  X,
  Sparkles,
  ArrowUp,
  Check,
  MessageSquare,
  FilePenLine,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";


import { useWorkbench } from "@/state/workbench";
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: { title: string; projectId: string; owner: string; kind: string };
  confirmed?: boolean;
};
export function ProjectAssistant() {
  const { state, dispatch } = useWorkbench();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [project, setProject] = useState("RCJM1");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (!open)
          setProject(
            state.currentProjectId,
          );
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, location.pathname, state.currentProjectId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stageContext, setStageContext] = useState("");
  const [, setArtifactContext] = useState<AgentArtifact | null>(
    null,
  );
  useEffect(() => {
    function openNode(event: Event) {
      const detail = (
        event as CustomEvent<{
          projectId: string;
          stage: string;
          prompt: string;
          artifact?: AgentArtifact;
        }>
      ).detail;
      setMessages([]);
      setArtifactContext(detail.artifact || null);
      setProject(detail.projectId);
      setStageContext(detail.stage);
      setInput(detail.prompt);
      setOpen(true);
    }
    window.addEventListener("presales-assistant-open", openNode);
    return () =>
      window.removeEventListener("presales-assistant-open", openNode);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open]);
  function show() {
    setProject(
      state.currentProjectId,
    );
    setStageContext("");
    setArtifactContext(null);
    setMessages([]);
    setOpen(true);
  }
  async function send(text = input) {
    if (!text.trim() || busy) return;
    const value = text.trim();
    const history = messages.slice(-10).map(({role,text})=>({role,text}));
    setMessages(prev=>[...prev,{id:randomId(),role:"user",text:value}]);
    setInput("");setBusy(true);setError("");
    try {
      const result = await localApi<{answer:string;proposal:null|{title:string;kind:string}}>("/api/project-assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({project_id:project,question:value,history})});
      setMessages(prev=>[...prev,{id:randomId(),role:"assistant",text:result.answer,...(result.proposal?{proposal:{...result.proposal,projectId:project,owner:state.role}}:{})}]);
    } catch(e) {setError(e instanceof Error?e.message:"发送失败，请重试");setInput(value);}
    finally {setBusy(false);}
  }
  return (
    <>
      <button
        className="assistant-launcher"
        aria-label="打开项目助手"
        onClick={show}
      >
        <Sparkles size={17} />
        <span>助手</span>
        <kbd>⌘ J</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent
          className="assistant-panel"
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              <Sparkles size={18} />
              项目助手
            </DialogTitle>
            <DialogDescription className="sr-only">
              查询项目资料和进度，整理客户变更并确认登记。
            </DialogDescription>
          </DialogHeader>
          <div className="assistant-context">
            <select
              aria-label="助手当前项目"
              value={project}
              disabled={busy}
              onChange={(e) => {
                setProject(e.target.value);
                setStageContext("");
                setArtifactContext(null);
                setMessages([]);
              }}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span>
              {stageContext ? stageContext + " · " : ""}
              {state.role}
            </span>
          </div>
          <div className="assistant-messages">
            {!messages.length && (
              <div className="assistant-empty">
                <MessageSquare size={30} />
                <h3>从项目开始</h3>
                {[
                  "查看项目当前状态",
                  "查找技术规格书与点表",
                  "记录客户要求变更",
                ].map((text) => (
                  <button
                    key={text}
                    onClick={() =>
                      text.includes("变更")
                        ? setInput("客户要求变更：")
                        : send(text)
                    }
                  >
                    {text}
                    <ArrowUp size={13} />
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <article key={m.id} className={"assistant-message " + m.role}>
                <MarkdownReply text={m.text}/>
                {m.proposal && (
                  <div className="assistant-proposal">
                    <div>
                      <FilePenLine size={14} />
                      <strong>{m.proposal.kind}</strong>
                    </div>
                    <label>
                      项目
                      <select
                        value={m.proposal.projectId}
                        disabled={m.confirmed || busy}
                        onChange={(e) =>
                          setMessages((prev) =>
                            prev.map((item) =>
                              item.id === m.id
                                ? {
                                    ...item,
                                    proposal: {
                                      ...item.proposal!,
                                      projectId: e.target.value,
                                    },
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        {state.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      内容
                      <textarea
                        rows={3}
                        value={m.proposal.title}
                        disabled={m.confirmed || busy}
                        onChange={(e) =>
                          setMessages((prev) =>
                            prev.map((item) =>
                              item.id === m.id
                                ? {
                                    ...item,
                                    proposal: {
                                      ...item.proposal!,
                                      title: e.target.value,
                                    },
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      跟进岗位
                      <input
                        value={m.proposal.owner}
                        disabled={m.confirmed || busy}
                        onChange={(e) =>
                          setMessages((prev) =>
                            prev.map((item) =>
                              item.id === m.id
                                ? {
                                    ...item,
                                    proposal: {
                                      ...item.proposal!,
                                      owner: e.target.value,
                                    },
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      className="btn primary full"
                      disabled={
                        m.confirmed || busy ||
                        !m.proposal.title.trim() ||
                        !m.proposal.owner.trim()
                      }
                      onClick={async () => {
                        if (!m.proposal || busy) return;
                        setBusy(true);setError("");
                        try {
                          const entry=await localApi<(typeof state.followups)[number]>("/api/project-assistant/records",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:m.id,project_id:m.proposal.projectId,title:m.proposal.title,owner:m.proposal.owner,kind:m.proposal.kind})});
                          dispatch({type:"hydrateShared",state:{...state,followups:[entry,...state.followups.filter(f=>f.id!==entry.id)]}});
                          setMessages(prev=>prev.map(item=>item.id===m.id?{...item,confirmed:true}:item));
                        } catch(e) {setError(e instanceof Error?e.message:"登记失败，请重试");}
                        finally {setBusy(false);}
                      }}
                    >
                      {m.confirmed ? (
                        <>
                          <Check size={14} />
                          已登记待跟进
                        </>
                      ) : (
                        "确认登记"
                      )}
                    </button>
                    {m.confirmed && <small>原始资料与已审工件保持原状。</small>}
                  </div>
                )}
              </article>
            ))}
            {busy && <p role="status">正在查询项目资料…</p>}{error && <p role="alert">{error}</p>}<div ref={end} />
          </div>
          <form
            className="assistant-compose"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              aria-label="向项目助手提问"
              placeholder="询问项目，或描述希望变更的内容…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button aria-label="发送消息" disabled={busy || !input.trim()}>
              <ArrowUp size={18} />
            </button>
            <small>Enter 发送，Shift + Enter 换行 · 变更经确认后登记</small>
          </form>
          <button aria-label="关闭项目助手" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
