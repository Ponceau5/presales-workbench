import {
  executeAgentTask,
  inferTask,
  type AgentArtifact,
} from "@/lib/agentTasks";
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
import { stagesForProject } from "@/lib/projectStages";
import { roleWork } from "@/lib/workspace";
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
            location.pathname.includes("RCJM1") || location.pathname === "/"
              ? "RCJM1"
              : state.currentProjectId,
          );
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, location.pathname, state.currentProjectId]);
  const [stageContext, setStageContext] = useState("");
  const [artifactContext, setArtifactContext] = useState<AgentArtifact | null>(
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
      location.pathname.includes("RCJM1") || location.pathname === "/"
        ? "RCJM1"
        : state.currentProjectId,
    );
    setStageContext("");
    setArtifactContext(null);
    setMessages([]);
    setOpen(true);
  }
  function send(text = input) {
    if (!text.trim()) return;
    const value = text.trim();
    const change =
      /^(请|帮我)?(新增|添加|增加|登记|创建|标记).*(跟进|任务)|^(请|帮我)?(把|将).*(改成|修改为|调整为)/.test(
        value,
      );
    const p = state.projects.find((p) => p.id === project)!;
    let reply = "";
    if (change)
      reply =
        "已整理为" +
        (/改|调整/.test(value) ? "修改建议" : "跟进建议") +
        "，请确认项目与内容。";
    else if (artifactContext) {
      const task = executeAgentTask(
        project,
        stageContext,
        artifactContext,
        inferTask(value),
        value,
        [artifactContext.source],
        state.role,
      );
      reply = task.findings
        .map((f) => f.title + "：" + f.text + "\n依据：" + f.source)
        .join("\n\n");
      dispatch({
        type: "agentRun",
        projectId: project,
        id: artifactContext.id,
        summary: JSON.stringify(task),
      });
    } else if (
      stageContext &&
      stagesForProject(project).some((s) => s.id === stageContext)
    ) {
      const node = stagesForProject(project).find(
        (s) => s.id === stageContext,
      )!;
      reply = `${node.title}：${node.goal}\n资料依据：${node.source}\n待确认：${node.question}\n责任岗位：${node.owner}`;
    } else if (/该做|做什么|任务|帮我|下一步/.test(value))
      reply =
        roleWork[state.role].tasks.join("；") +
        "。我可以整理资料与待办、提出修改建议；批准和写回由责任账号完成。";
    else if (project === "RCJM1")
      reply = /文件|资料|规格|点表/.test(value)
        ? "RCJM1 已登记点表、BMS 配置、BA 清单、PTC 澄清、SOO、技术规格书和图纸目录。点表、规格书、控制序列与 DCOM 需求可在“资料与工件”内阅读全文；F3 提供逐行统计，F5 提供分工件复核。"
        : "项目记录显示 RCJM1 已中标，处于执行交付阶段。Phase 1 RFS 登记为 2026-11-06；Server OS、交换机供货、设备授权及分期日期存在待核实事项。来源：项目笔记 2026-09-15。";
    else
      reply = `${p.name} 可按项目流程查看资料、专业协作、报价与合同环节。F5 的 F3S 工作区提供本轮软件评审演示。`;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: value },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: reply,
        ...(change
          ? {
              proposal: {
                title: value.replace(
                  /^(请)?(新增|添加|增加)(一项)?(待)?跟进[：:，\s]*/,
                  "",
                ),
                projectId: project,
                owner: state.role,
                kind: /改|调整/.test(value) ? "修改建议" : "新增跟进",
              },
            }
          : {}),
      },
    ]);
    setInput("");
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
              项目助手 <span>演示</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              对话查询项目，预览变更建议并登记待跟进事项。演示回复不调用 LLM。
            </DialogDescription>
          </DialogHeader>
          <div className="assistant-context">
            <select
              aria-label="助手当前项目"
              value={project}
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
                  "添加一项待跟进事项",
                ].map((text) => (
                  <button
                    key={text}
                    onClick={() =>
                      text.includes("添加")
                        ? setInput("添加待跟进：")
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
                <p>{m.text}</p>
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
                        disabled={m.confirmed}
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
                        disabled={m.confirmed}
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
                        disabled={m.confirmed}
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
                        m.confirmed ||
                        !m.proposal.title.trim() ||
                        !m.proposal.owner.trim()
                      }
                      onClick={() => {
                        dispatch({
                          type: "followup",
                          projectId: m.proposal!.projectId,
                          title: m.proposal!.title,
                          owner: m.proposal!.owner,
                          source: "项目助手建议",
                        });
                        setMessages((prev) =>
                          prev.map((item) =>
                            item.id === m.id
                              ? { ...item, confirmed: true }
                              : item,
                          ),
                        );
                      }}
                    >
                      {m.confirmed ? (
                        <>
                          <Check size={14} />
                          已登记待跟进
                        </>
                      ) : (
                        "确认建议"
                      )}
                    </button>
                    {m.confirmed && <small>原始资料与已审工件保持原状。</small>}
                  </div>
                )}
              </article>
            ))}
            <div ref={end} />
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
            <button aria-label="发送消息" disabled={!input.trim()}>
              <ArrowUp size={18} />
            </button>
            <small>演示回复 · Enter 发送，Shift + Enter 换行</small>
          </form>
          <button aria-label="关闭项目助手" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
