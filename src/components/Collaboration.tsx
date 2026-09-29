import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Inbox, Search } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import type { Delivery } from "@/lib/collaboration";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const label = (d: Delivery) =>
  d.outdated && d.status !== "returned"
    ? "版本失效"
    : d.status === "accepted"
      ? "已接收"
      : d.status === "returned"
        ? "已退回"
        : "待接收";
export function DeliveryDialog({
  delivery,
  onClose,
}: {
  delivery: Delivery | null;
  onClose: () => void;
}) {
  const { state, dispatch } = useWorkbench();
  const [note, setNote] = useState("");
  const current =
    state.deliveries.find((d) => d.id === delivery?.id) || delivery;
  return (
    <Dialog
      open={!!delivery}
      onOpenChange={(v) => {
        if (!v) {
          setNote("");
          onClose();
        }
      }}
    >
      <DialogContent className="delivery-dialog">
        <DialogHeader>
          <DialogTitle>{current?.title}</DialogTitle>
          <DialogDescription>
            {current?.fromStage} → {current?.toStage} · {current?.version} ·{" "}
            {current?.senderRole}交付给{current?.owner}
          </DialogDescription>
        </DialogHeader>
        {current && (
          <>
            <div className="delivery-meta">
              <span>{label(current)}</span>
              <time>
                {new Date(current.at).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </time>
            </div>
            <pre className="delivery-document">{current.text}</pre>
            <div className="delivery-evidence">
              <strong>依据</strong>
              <p>{current.evidence}</p>
            </div>
            {current.note && (
              <p className="delivery-receipt">
                {current.receivedBy} · {current.note}
              </p>
            )}
            {current.owner === state.role &&
              (current.status === "pending" ||
                (current.outdated && current.status === "accepted")) && (
                <>
                  <label className="form-label">
                    接收说明 / 退回原因
                    <textarea
                      aria-label="交接处理说明"
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="核对输入版本、范围及缺项"
                    />
                  </label>
                  <div className="delivery-actions">
                    <button
                      className="btn secondary"
                      disabled={!note.trim()}
                      onClick={() => {
                        dispatch({
                          type: "deliveryReceive",
                          id: current.id,
                          projectId: current.projectId,
                          status: "returned",
                          note,
                        });
                        setNote("");
                        onClose();
                      }}
                    >
                      退回
                    </button>
                    <button
                      className="btn primary"
                      disabled={current.outdated || !note.trim()}
                      onClick={() => {
                        dispatch({
                          type: "deliveryReceive",
                          id: current.id,
                          projectId: current.projectId,
                          status: "accepted",
                          note,
                        });
                        setNote("");
                        onClose();
                      }}
                    >
                      接收为环节输入
                    </button>
                  </div>
                </>
              )}
            <Link
              className="text-link"
              to={`/projects/${current.projectId}?view=review&stage=${current.toStage}`}
              onClick={onClose}
            >
              打开接收环节 <ArrowRight size={14} />
            </Link>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function StageHandoffs({
  projectId,
  stage,
}: {
  projectId: string;
  stage: string;
}) {
  const { state } = useWorkbench();
  const [opened, setOpened] = useState<Delivery | null>(null);
  const inputs = state.deliveries.filter(
    (d) =>
      d.projectId === projectId &&
      d.toStage === stage &&
      d.status !== "returned",
  );
  const pending = inputs.filter(
    (d) => d.owner === state.role && (d.status === "pending" || d.outdated),
  );
  if (!inputs.length) return null;
  return (
    <>
      <div
        className={
          "stage-handoffs " +
          (pending.some((d) => d.outdated) ? "has-outdated" : "")
        }
      >
        <Inbox size={15} />
        <strong>上游交接</strong>
        <span>
          {inputs.filter((d) => d.status === "accepted" && !d.outdated).length}{" "}
          已接收
        </span>
        {pending.slice(0, 3).map((d) => (
          <button key={d.id} onClick={() => setOpened(d)}>
            {d.fromStage} · {d.title}
            <b>{label(d)}</b>
          </button>
        ))}
        <Link to={`/projects/${projectId}?view=collaboration`}>
          全部交接 <ArrowRight size={13} />
        </Link>
      </div>
      <DeliveryDialog
        key={opened?.id}
        delivery={opened}
        onClose={() => setOpened(null)}
      />
    </>
  );
}
export function Collaboration({ projectId }: { projectId?: string }) {
  const { state } = useWorkbench();
  const [scope, setScope] = useState("全部");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Delivery | null>(null);
  const all = state.deliveries.filter(
    (d) => !projectId || d.projectId === projectId,
  );
  const visible = all.filter(
    (d) =>
      (scope === "全部" ||
        (scope === "待我接收" &&
          d.owner === state.role &&
          d.status === "pending") ||
        (scope === "版本失效" && d.outdated && d.status !== "returned") ||
        (scope === "已接收" && d.status === "accepted" && !d.outdated)) &&
      `${d.title}${d.fromStage}${d.toStage}${d.owner}${d.senderRole}`.includes(
        query,
      ),
  );
  return (
    <section className="collaboration-register">
      <header>
        <h2>
          协作交接 <span>{all.length}</span>
        </h2>
        <div className="segmented">
          {["全部", "待我接收", "版本失效", "已接收"].map((s) => (
            <button
              className={scope === s ? "selected" : ""}
              key={s}
              onClick={() => setScope(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <label>
          <Search size={14} />
          <input
            aria-label="搜索交接"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="工件、环节、岗位"
          />
        </label>
      </header>
      <div className="delivery-table-scroll">
        <table className="delivery-table">
          <thead>
            <tr>
              <th>输出工件</th>
              <th>交付 → 接收</th>
              <th>版本</th>
              <th>责任岗位</th>
              <th>状态</th>
              <th>更新时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id}>
                <td>
                  <button
                    className="delivery-title"
                    onClick={() => setOpened(d)}
                  >
                    {d.title}
                  </button>
                  {!projectId && (
                    <small>
                      {state.projects.find((p) => p.id === d.projectId)?.name}
                    </small>
                  )}
                </td>
                <td>
                  {d.fromStage} → {d.toStage}
                </td>
                <td>{d.version}</td>
                <td>
                  <span>{d.senderRole}</span>
                  <small>→ {d.owner}</small>
                </td>
                <td>
                  <span
                    className={
                      "delivery-status " + (d.outdated ? "stale" : d.status)
                    }
                  >
                    {label(d)}
                  </span>
                </td>
                <td>
                  {new Date(d.receivedAt || d.at).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </td>
                <td>
                  <button className="text-link" onClick={() => setOpened(d)}>
                    {d.owner === state.role &&
                    d.status === "pending" &&
                    !d.outdated
                      ? "查看并接收"
                      : "查看全文"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <div className="delivery-empty">
            <Inbox size={24} />
            <strong>
              {all.length ? "没有符合筛选条件的交接" : "尚无已交付工件"}
            </strong>
            <p>环节完成复核并写回后，输出将交给下一岗位。</p>
          </div>
        )}
      </div>
      <DeliveryDialog
        key={opened?.id}
        delivery={opened}
        onClose={() => setOpened(null)}
      />
    </section>
  );
}
