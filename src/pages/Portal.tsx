import { Collaboration } from "@/components/Collaboration";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  Activity,
  Bot,
  Expand,
  Search,
  ShieldAlert,
  Radio,
} from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { pipelineSteps } from "@/lib/presales";
import { projectFileCatalog } from "@/lib/projectFileCatalog";
import { projectChanges } from "@/lib/projectChanges";
import { stagesForProject } from "@/lib/projectStages";
import { readProjectReview } from "@/lib/projectReview";
import { referenceItems } from "@/lib/referenceReview";
import { demoReviewItems } from "@/lib/demoReview";
import { rackIssues } from "@/lib/portfolio";
import { projectTasks } from "@/lib/projectTasks";
import { roles } from "@/lib/workspace";
const lanes = [
  { name: "资料准备", ids: ["F1", "F2"] },
  { name: "专业协作", ids: ["F3", "F4", "F5", "F6"] },
  { name: "报价投标", ids: ["F7", "F8", "F9", "F10"] },
  { name: "合同交付", ids: ["F11", "F12", "F13"] },
];
export default function Portal() {
  const { state } = useWorkbench();
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const files = [
    ...state.resources,
    ...projectFileCatalog.filter(
      (r) => !state.resources.some((s) => s.path === r.path),
    ),
  ];
  const projects = state.projects.map((p) => {
    const snapshot = p.id === state.currentProjectId ? state : p.snapshot;
    const review = readProjectReview(p.id, state);
    const items = p.reference ? referenceItems : demoReviewItems;
    const pending = items.filter((i) => !review.rows[i.id]?.written);
    const blockers = pending.filter(
      (i) => i.blocker && !review.rows[i.id]?.resolution,
    );
    const changes = projectChanges(state, p.id).filter(
      (c) => !["已写回", "已完成", "已关闭"].includes(c.status),
    );
    return {
      p,
      snapshot,
      review,
      items,
      pending,
      blockers,
      changes,
      files: files.filter((f) => f.projectId === p.id),
      completed: Object.values(snapshot?.stageStates || {}).filter(
        (s) => s.written,
      ).length,
    };
  });
  const visible = projects.filter(
    (x) =>
      (x.p.name + x.p.id).toLowerCase().includes(query.toLowerCase()) &&
      (!focus || x.blockers.length || x.changes.length),
  );
  const changeRows = projects.flatMap((x) =>
    x.changes.map((c) => ({ ...c, projectId: x.p.id })),
  );
  const pending = [
    ...new Map(
      roles
        .filter((r) => r !== "PM / PO")
        .flatMap((role) =>
          projectTasks({ ...state, role }).filter(
            (t) =>
              t.stage !== "交接" &&
              !["待跟进", "待处理答复"].includes(t.status),
          ),
        )
        .map((t) => [t.id, t]),
    ).values(),
  ];
  const owners = [...new Set(pending.map((i) => i.owner))];
  const events = state.activity.slice(0, 8);
  const issues = [
    ...rackIssues.map((i) => ({
      ...i,
      owner: /点表/.test(i.title)
        ? "解决方案"
        : /设备授权/.test(i.title)
          ? "研发"
          : /交付/.test(i.title)
            ? "商务支持"
            : /交换机/.test(i.title)
              ? "销售"
              : "软件产品",
      projectId: "RCJM1",
    })),
    ...state.followups
      .filter(
        (f) =>
          f.status !== "done" &&
          !rackIssues.some(
            (i) => f.projectId === "RCJM1" && i.title === f.title,
          ),
      )
      .map((f) => ({
        id: f.id,
        title: f.title,
        owner: f.owner,
        text: "待跟进",
        stage: "F5",
        projectId: f.projectId,
      })),
  ];
  const totals = [
    { title: "监控项目", value: projects.length, unit: "个" },
    { title: "待办工件", value: pending.length, unit: "项" },
    {
      title: "未确认风险",
      value: projects.reduce((n, x) => n + x.blockers.length, 0),
      unit: "项",
      risk: true,
    },
    { title: "版本待复核", value: changeRows.length, unit: "项", risk: true },
    { title: "项目资料", value: files.length.toLocaleString(), unit: "份" },
    {
      title: "索引容量",
      value: (files.reduce((n, f) => n + (f.size || 0), 0) / 1024 ** 3).toFixed(
        2,
      ),
      unit: "GB",
    },
  ];
  return (
    <div className="mission-control">
      <header className="mission-header">
        <div>
          <Radio size={22} />
          <h1>项目监控</h1>
          <span>售前协同驾驶舱</span>
        </div>
        <div className="mission-clock">
          <span className="session-signal">本机共享</span>
          <time>{now.toLocaleTimeString("zh-CN", { hour12: false })}</time>
          <button
            aria-label="全屏监控"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else
                void document.documentElement
                  .requestFullscreen()
                  .catch(() => {});
            }}
          >
            <Expand size={17} />
          </button>
        </div>
      </header>
      <div className="mission-ticker">
        <Activity size={14} />
        <strong>最新动态</strong>
        {events.length ? (
          <Link to="/activity">
            {events[0].projectId} · {events[0].role} ·{" "}
            {state.deliveries.find((d) => d.id === events[0].target)?.title ||
              events[0].target}{" "}
            ·{" "}
            {(
              {
                edit: "修改工件",
                write: "写回事实",
                approve: "复核批准",
                followup: "新增跟进",
                followupComplete: "完成跟进",
                followupAccept: "已阅答复",
                agentRun: "执行 Agent 任务",
                publishSoftware: "交付软件工件",
                deliveryReceive: "处理交接",
              } as Record<string, string>
            )[events[0].action] || events[0].action}
            <ArrowUpRight size={12} />
          </Link>
        ) : (
          <span>等待项目操作记录</span>
        )}
        <span className="mission-ticker-count">
          {state.activity.length} 条操作记录
        </span>
      </div>
      <section className="mission-metrics">
        {totals.map((t) => (
          <div key={t.title} className={t.risk ? "risk" : ""}>
            <span>{t.title}</span>
            <strong>
              {t.value}
              <small>{t.unit}</small>
            </strong>
          </div>
        ))}
      </section>
      <div className="mission-grid">
        <section className="mission-panel mission-projects">
          <header>
            <h2>项目进度</h2>
            <label>
              <Search size={13} />
              <input
                aria-label="搜索监控项目"
                placeholder="项目名称 / 编号"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              className={focus ? "active" : ""}
              onClick={() => setFocus(!focus)}
            >
              只看需关注
            </button>
            <Link to="/projects">全部项目 ↗</Link>
          </header>
          <div className="mission-stage-matrix">
            <div className="mission-phase-heading">
              <span>项目 / 范围</span>
              {lanes.map((l) => (
                <span
                  key={l.name}
                  style={{ gridColumn: "span " + l.ids.length }}
                >
                  {l.name}
                </span>
              ))}
              <span>待办 / 变更</span>
            </div>
            {visible.map(({ p, snapshot, changes, completed }) => (
              <div className="mission-project-row" key={p.id}>
                <Link
                  className="mission-project-label"
                  to={"/projects/" + p.id}
                >
                  <strong>{p.name.replace(" · RCJM1", "")}</strong>
                  <span>
                    {p.id} ·{" "}
                    {p.reference ? "BMS / DCIM / BA" : "监控与软件集成"}
                  </span>
                </Link>
                {pipelineSteps
                  .filter((s) => s.id !== "F14")
                  .map((s) => ({
                    id: s.id,
                    title:
                      stagesForProject(p.id).find((d) => d.id === s.id)
                        ?.title || s.label,
                  }))
                  .map((s) => (
                    <Link
                      key={s.id}
                      title={
                        s.title +
                        " · " +
                        (snapshot?.stageStates[s.id]?.written
                          ? "已写回"
                          : snapshot?.stageStates[s.id]?.generated
                            ? "待人审"
                            : "待处理")
                      }
                      className={
                        "mission-stage " +
                        (snapshot?.stageStates[s.id]?.written
                          ? "done"
                          : snapshot?.stageStates[s.id]?.generated
                            ? "review"
                            : changes.some((c) => c.affected.includes(s.id))
                              ? "changed"
                              : "")
                      }
                      to={"/projects/" + p.id + "?view=flow&stage=" + s.id}
                    >
                      {s.id}
                    </Link>
                  ))}
                <div className="mission-project-count">
                  <Link
                    to={
                      pending.find((t) => t.projectId === p.id)?.url ||
                      "/projects/" + p.id
                    }
                  >
                    {pending.filter((t) => t.projectId === p.id).length} 任务
                  </Link>
                  <Link to={"/projects/" + p.id + "?view=changes"}>
                    {changes.length} 变更
                  </Link>
                  <small>{completed}/13 写回</small>
                </div>
              </div>
            ))}
          </div>
          <footer className="mission-legend">
            <span>
              <i className="done" />
              已写回
            </span>
            <span>
              <i className="review" />
              待人审
            </span>
            <span>
              <i className="changed" />
              变更影响
            </span>
            <span>
              <i />
              待处理
            </span>
          </footer>
          <div className="mission-node-workload" aria-label="环节任务分布">
            {pipelineSteps
              .filter((s) => s.id !== "F14")
              .map((s) => {
                const tasks = pending.filter((t) => t.stage === s.id);
                return (
                  <Link
                    key={s.id}
                    to={tasks[0]?.url || "/projects"}
                    title={s.label}
                  >
                    <span>{s.id}</span>
                    <b>{tasks.length}</b>
                    <small>{s.label}</small>
                  </Link>
                );
              })}
          </div>
        </section>
        <section className="mission-panel mission-roles">
          <header>
            <h2>专业任务队列</h2>
            <Link to="/tasks">我的任务 ↗</Link>
          </header>
          {owners.map((owner) => (
            <Link key={owner} to={pending.find((i) => i.owner === owner)!.url}>
              <span>{owner}</span>
              <div>
                <i
                  style={{
                    width:
                      (pending.filter((i) => i.owner === owner).length /
                        Math.max(1, pending.length)) *
                        100 +
                      "%",
                  }}
                />
              </div>
              <b>{pending.filter((i) => i.owner === owner).length}</b>
            </Link>
          ))}
          <div className="mission-agent-status">
            <Bot size={16} />
            <span>Agent 执行</span>
            <strong>{state.running ? "处理中" : "等待任务"}</strong>
          </div>
        </section>
        <div className="mission-collaboration">
          <Collaboration />
        </div>
        <section className="mission-panel mission-change-feed">
          <header>
            <h2>变更影响</h2>
            <span>{changeRows.length} 项待复核</span>
          </header>
          <div className="mission-feed-scroll">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>变更内容</th>
                  <th>影响环节</th>
                  <th>责任</th>
                  <th>版本</th>
                </tr>
              </thead>
              <tbody>
                {changeRows.map((c) => (
                  <tr key={c.projectId + c.id}>
                    <td>{c.projectId}</td>
                    <td>
                      <Link to={"/projects/" + c.projectId + "?view=changes"}>
                        {c.title}
                      </Link>
                    </td>
                    <td>{c.affected.join(" / ")}</td>
                    <td>{c.owner}</td>
                    <td>{c.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mission-panel mission-risk-feed">
          <header>
            <h2>
              <ShieldAlert size={14} />
              关注事项
            </h2>
            <span>{issues.length}</span>
          </header>
          <div className="mission-feed-scroll">
            {issues.map((i) => (
              <Link
                key={i.projectId + i.id}
                to={"/projects/" + i.projectId + "?view=attention"}
              >
                <strong>{i.title}</strong>
                <span>
                  {i.projectId} · {i.owner}
                </span>
                <p>{i.text}</p>
              </Link>
            ))}
          </div>
        </section>
        <section className="mission-panel mission-data">
          <header>
            <h2>资料分布</h2>
            <Link to="/library">公共资料 ↗</Link>
          </header>
          {projects.map((x) => (
            <Link key={x.p.id} to={"/projects/" + x.p.id + "?view=materials"}>
              <span>{x.p.id}</span>
              <div className="mission-file-strip">
                {["PDF", "DWG", "XLSX", "XLS", "DOCX"].map((format) => (
                  <span
                    key={format}
                    title={
                      format +
                      " " +
                      x.files.filter((f) => f.format === format).length
                    }
                    style={{
                      flex: Math.max(
                        1,
                        x.files.filter((f) => f.format === format).length,
                      ),
                    }}
                    data-format={format}
                  />
                ))}
              </div>
              <strong>{x.files.length}</strong>
            </Link>
          ))}
          <footer>PDF · CAD · 点表与配置 · 文档</footer>
        </section>
        <section className="mission-panel mission-audit">
          <header>
            <h2>操作流水</h2>
            <Link to="/activity">全部记录 ↗</Link>
          </header>
          <div className="mission-feed-scroll">
            {events.map((e) => (
              <Link key={e.id} to="/activity">
                <time>
                  {new Date(e.at).toLocaleTimeString("zh-CN", {
                    hour12: false,
                  })}
                </time>
                <span>{e.projectId}</span>
                <strong>{e.target}</strong>
                <span>
                  {e.accountId} · {e.role}
                </span>
              </Link>
            ))}
            {!events.length && <p>暂无操作记录</p>}
          </div>
        </section>
        <section className="mission-panel mission-delivery">
          <header>
            <h2>交付节点</h2>
          </header>
          <Link to="/projects/RCJM1?view=milestones">
            <span>RCJM1 · Phase 1 RFS</span>
            <strong>2026-11-06</strong>
            <small>日期待核实</small>
          </Link>
          <Link to="/projects/RCJM1?view=milestones">
            <span>RCJM1 · 暂定竣工</span>
            <strong>2027-08-06</strong>
            <small>项目档案登记</small>
          </Link>
        </section>
      </div>
    </div>
  );
}
