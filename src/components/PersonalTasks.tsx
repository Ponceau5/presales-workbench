import { DeliveryDialog } from "@/components/Collaboration";
import type { Delivery } from "@/lib/collaboration";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight, Search, CheckCheck } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { projectTasks } from "@/lib/projectTasks";
export function PersonalTasks() {
  const { state, dispatch } = useWorkbench();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [result, setResult] = useState("");
  const [, refresh] = useState(0);
  const [filter, setFilter] = useState("全部");
  const [project, setProject] = useState("全部项目");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const update = () => refresh((n) => n + 1);
    window.addEventListener("presales-reference-change", update);
    return () =>
      window.removeEventListener("presales-reference-change", update);
  }, []);
  const tasks = projectTasks(state);
  const visible = tasks.filter(
    (t) =>
      (filter === "全部" || t.status === filter) &&
      (project === "全部项目" || t.projectId === project) &&
      (t.title + t.projectName).includes(query),
  );
  return (
    <div className="task-inbox">
      <header className="inbox-heading">
        <div>
          <h1>
            我的任务 <span>{tasks.length}</span>
          </h1>
        </div>
        <span>{state.role}</span>
      </header>
      <div className="inbox-toolbar">
        <div className="segmented">
          {[
            "全部",
            "待接收",
            "版本失效",
            "待协调",
            "待处理答复",
            "待开始",
            "待确认",
            "待复核",
            "待交接",
            "待写回",
            "待跟进",
            "已驳回",
          ]
            .filter((f) => f === "全部" || tasks.some((t) => t.status === f))
            .map((f) => (
              <button
                key={f}
                className={filter === f ? "selected" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
                {f === "全部" ? (
                  ""
                ) : (
                  <span>{tasks.filter((t) => t.status === f).length}</span>
                )}
              </button>
            ))}
        </div>
        <select
          aria-label="筛选任务项目"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option>全部项目</option>
          {state.projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <label className="inbox-search">
        <Search size={16} />
        <input
          aria-label="搜索任务"
          placeholder="搜索任务"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="inbox-list">
        <div className="inbox-columns">
          <span>任务</span>
          <span>项目</span>
          <span>环节</span>
          <span>责任 / 交接来源</span>
          <span>状态</span>
          <span />
        </div>
        {visible.map((t) => (
          <div
            className={
              "inbox-entry " + (t.stage === "跟进" ? "followup-entry" : "")
            }
            key={t.id}
          >
            <Link className="inbox-row" to={t.url}>
              <div>
                <i className={t.priority ? "priority" : ""} />
                <strong>{t.title}</strong>
              </div>
              <span>{t.projectName}</span>
              <span>{t.stage}</span>
              <span>{t.owner || state.role}</span>
              <span className={"task-state " + (t.priority ? "attention" : "")}>
                {t.status}
              </span>
              <ArrowUpRight size={16} />
            </Link>
            {t.stage === "交接" && (
              <button
                className="task-complete"
                onClick={() =>
                  setDelivery(state.deliveries.find((d) => d.id === t.id)!)
                }
              >
                处理交接
              </button>
            )}
            {t.stage === "答复" && (
              <div className="task-response">
                <p>{state.followups.find((f) => f.id === t.id)?.result}</p>
                <button
                  className="btn secondary"
                  onClick={() =>
                    dispatch({
                      type: "followupAccept",
                      id: t.id,
                      projectId: t.projectId,
                    })
                  }
                >
                  标记已阅
                </button>
              </div>
            )}
            {t.stage === "跟进" && (
              <button
                className="task-complete"
                onClick={() => {
                  setCompleting(t.id);
                  setResult("");
                }}
              >
                完成
              </button>
            )}
          </div>
        ))}
        {!visible.length && (
          <div className="inbox-empty">
            <CheckCheck size={30} />
            <h2>暂无待处理任务</h2>
          </div>
        )}
      </div>
      <DeliveryDialog
        key={delivery?.id}
        delivery={delivery}
        onClose={() => setDelivery(null)}
      />
      <Dialog
        open={!!completing}
        onOpenChange={(v) => {
          if (!v) setCompleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>完成跟进</DialogTitle>
            <DialogDescription>
              {state.followups.find((f) => f.id === completing)?.title}
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            处理结果
            <textarea
              rows={4}
              value={result}
              onChange={(e) => setResult(e.target.value)}
            />
          </label>
          <button
            className="btn primary"
            disabled={!result.trim()}
            onClick={() => {
              const f = state.followups.find((f) => f.id === completing)!;
              dispatch({
                type: "followupComplete",
                id: f.id,
                projectId: f.projectId,
                result,
              });
              setCompleting(null);
            }}
          >
            完成并记录
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
