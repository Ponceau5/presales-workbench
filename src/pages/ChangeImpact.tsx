import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  GitCompareArrows,
  ListChecks,
  UserRound,
  CheckCircle2,
} from "lucide-react";
import { ChangeLog } from "@/components/ChangeLog";
import { stages } from "@/lib/stages";
import { changes, artifactMeta, type Artifact } from "@/lib/presales";
import { useWorkbench } from "@/state/workbench";
import { Heading, Section, Tag, Status } from "@/components/WorkbenchUI";
export default function ChangeImpact() {
  const { state, dispatch } = useWorkbench();
  const [selected, setSelected] = useState("D-01");
  const [filter, setFilter] = useState("all");
  const [owner, setOwner] = useState("全部岗位");
  const change = changes.find((c) => c.id === selected) || changes[0];
  const affected = state.rows.filter((r) => change.reqs.includes(r.req));
  const rows = changes.filter(
    (c) =>
      (filter === "all" || c.artifacts.includes(filter as Artifact)) &&
      (owner === "全部岗位" || c.owner === owner),
  );
  return (
    <>
      <Heading
        eyebrow="CHANGE IMPACT"
        title="变更影响"
        description="版本差异与受影响事项"
        action={
          <Tag tone="teal">
            <GitCompareArrows size={13} />
            规格书 V6 → V7
          </Tag>
        }
      />
      <ChangeLog projectId={state.currentProjectId} />
      <div className="change-summary">
        <div>
          <strong>02</strong>
          <span>条来源差异</span>
        </div>
        <div>
          <strong>04</strong>
          <span>类受影响工件</span>
        </div>
        <div>
          <strong>
            {
              Object.values(state.changeStatus).filter((s) => s === "done")
                .length
            }
            /2
          </strong>
          <span>完成复核与写回</span>
        </div>
        <div>
          <CheckCircle2 size={20} />
          <span>
            未受影响的已审内容
            <br />
            <strong className="small">保留，不进入全量重审</strong>
          </span>
        </div>
      </div>
      <div className="change-layout">
        <Section title="变化清单" extra={<Tag>2 条</Tag>}>
          <div className="change-filters">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="按影响工件筛选"
            >
              <option value="all">全部工件</option>
              {Object.entries(artifactMeta).map(([key, a]) => (
                <option key={key} value={key}>
                  {a.label}
                </option>
              ))}
            </select>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="按处理岗位筛选"
            >
              {["全部岗位", "软件产品", "研发"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          {rows.map((c) => (
            <button
              key={c.id}
              className={`change-item ${selected === c.id ? "selected" : ""}`}
              onClick={() => setSelected(c.id)}
            >
              <div>
                <span className="mono">{c.id}</span>
                <Status value={state.changeStatus[c.id]} />
              </div>
              <h3>{c.title}</h3>
              <p>{c.section}</p>
              <small>
                {c.owner} · {c.artifacts.length} 类工件
              </small>
            </button>
          ))}
          {!rows.length ? (
            <p className="empty-state">没有符合条件的变化。</p>
          ) : null}
        </Section>
        <div>
          <Section
            title={change.title}
            extra={<Status value={state.changeStatus[change.id]} />}
          >
            <div className="diff-grid">
              <div className="diff-before">
                <small>V6 · 旧版</small>
                <p>
                  <del>{change.before}</del>
                </p>
              </div>
              <div className="diff-after">
                <small>V7 · 新版</small>
                <p>{change.after}</p>
              </div>
            </div>
            <div className="impact-description">
              <Tag tone="red">
                {change.id === "D-01" ? "高风险歧义" : "部署输入变更"}
              </Tag>
              <p>{change.action}</p>
              <small>{change.section} · 合成规格书版本差异</small>
            </div>
          </Section>
          <Section
            title="受影响工件"
            extra={
              <span className="small muted">
                {affected.length} 条受影响记录
              </span>
            }
          >
            <div className="impact-table">
              <div className="impact-table-head">
                <span>受影响工件 / 条目</span>
                <span>责任岗位</span>
                <span>当前状态</span>
              </div>
              {affected.map((r) => (
                <div className="impact-table-row" key={r.id}>
                  <Link
                    to={"/software?artifact=" + r.artifact + "&req=" + r.req}
                  >
                    {artifactMeta[r.artifact].label}
                    <small>
                      {r.id} · {r.title}
                    </small>
                  </Link>
                  <span>
                    <UserRound size={13} />
                    {r.owner}
                  </span>
                  <Status value={r.status} />
                </div>
              ))}
            </div>
            <div className="change-action-note">
              <ListChecks size={17} />
              <div>
                <strong>
                  只让 {affected.map((r) => r.id).join("、")} 重新进入评审
                </strong>
                <p>
                  应用新版会撤销这些条目的批准与有效事实；旧记录留在历史中。其余条目保留。
                </p>
              </div>
            </div>
            <div className="change-actions">
              <button
                className="btn secondary"
                disabled={
                  !["软件产品", "研发", "PM / PO"].includes(state.role) ||
                  state.running ||
                  state.changeStatus[change.id] !== "pending"
                }
                onClick={() =>
                  dispatch({
                    type: "change",
                    id: change.id,
                    status: "assigned",
                  })
                }
              >
                派发给 {change.owner}
              </button>
              <button
                className="btn primary"
                disabled={
                  !["软件产品", "研发", "PM / PO"].includes(state.role) ||
                  state.running ||
                  !state.generated ||
                  ["reviewing", "done"].includes(state.changeStatus[change.id])
                }
                onClick={() =>
                  dispatch({
                    type: "change",
                    id: change.id,
                    status: "reviewing",
                  })
                }
              >
                应用新版并创建受影响评审
                <ArrowRight size={15} />
              </button>
              {state.changeStatus[change.id] === "reviewing" ? (
                <Link
                  className="btn secondary"
                  to={"/software?req=" + change.reqs[0]}
                >
                  进入受影响条目
                </Link>
              ) : null}
            </div>
            {!state.generated ? (
              <p className="panel-footnote">
                请先在 F5 运行 Agent，建立 V6 初稿，再演示 V7 更新。
              </p>
            ) : null}
          </Section>
          <Section title="行动留痕">
            <div className="activity-list">
              {state.audit
                .filter((a) => a.target === change.id || a.action === "write")
                .map((a) => (
                  <div key={a.id}>
                    <span className="dot" />
                    <p>
                      <strong>
                        {a.action} · {a.actor}
                      </strong>
                      <small>
                        {new Date(a.at).toLocaleString()} · {a.note}
                      </small>
                    </p>
                  </div>
                ))}
              {!state.audit.some((a) => a.target === change.id) ? (
                <p className="muted small">
                  尚未派发。派发、批准撤销与事实写回均留下记录。
                </p>
              ) : null}
            </div>
          </Section>
        </div>
      </div>
      <Section
        title="其他售前环节的变更行动"
        extra={<Tag>配置 · 报价 · 合同 · 计划</Tag>}
      >
        <div className="stage-change-grid">
          {stages
            .filter((d) => state.stageStates[d.id].change)
            .map((d) => {
              const s = state.stageStates[d.id];
              return (
                <Link key={d.id} to={"/stages/" + d.id}>
                  <div>
                    <strong>
                      {d.id} · {d.title}
                    </strong>
                    <Tag tone={s.written ? "green" : "amber"}>
                      {s.written
                        ? "已重审写回"
                        : s.assigned
                          ? "已派发 · 待处理"
                          : "待派发"}
                    </Tag>
                  </div>
                  <p>{d.change}</p>
                  <small>
                    影响 {d.next.join(" / ")} · 处理人 {d.owner}
                  </small>
                </Link>
              );
            })}
          {!stages.some((d) => state.stageStates[d.id].change) ? (
            <p className="muted small">
              在 F1～F13 任一环节应用 V2
              变更后，这里统一显示差异、下游影响与处理状态。
            </p>
          ) : null}
        </div>
      </Section>
    </>
  );
}
