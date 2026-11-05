import {FloatingNotice} from "@/components/FloatingNotice";
import { projectFileCatalog } from "@/lib/projectFileCatalog";
import { rackIssues } from "@/lib/portfolio";
import { projectChanges } from "@/lib/projectChanges";
import { canCreateProject } from "@/lib/accounts";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Search, Star } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkbench, type Project as WorkbenchProject } from "@/state/workbench";
import { localApi } from "@/lib/localApi";
import { randomId } from "@/lib/id";
import { roles, type Role } from "@/lib/workspace";
import "./projects.css";

type Project = WorkbenchProject;
type ProjectDetail = { id: string; name: string; scope: string; owner_role: string; created_at: string };
const roleKeys: Record<Role, string> = { 销售: "sales", 市场: "marketing", 解决方案: "solution", 硬件产品: "hardware", 软件产品: "software", 商务支持: "commercial", "财务 / 风控": "finance", 货运关务: "logistics", 研发: "dev", "认证 / 法务": "legal", 系统管理员: "admin" };
const roleNames = Object.fromEntries(Object.entries(roleKeys).map(([name, key]) => [key, name]));

export default function Projects() {
  const { state, dispatch } = useWorkbench();
  const navigate = useNavigate();
  const [openedAt] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const followKey = `presales-followed-projects:${state.accountId || "guest"}`;
  const [followed, setFollowed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(followKey) || "[]"); } catch { return []; } });
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const [create, setCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<Role>(state.role);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = state.role === "系统管理员";

  function toggleFollow(id: string) {
    const next = followed.includes(id) ? followed.filter((value) => value !== id) : [...followed, id];
    localStorage.setItem(followKey, JSON.stringify(next)); setFollowed(next);
  }
  function updateTime(value: string) {
    if (value === "刚刚") return openedAt;
    const normalized = /^\d{2}\.\d{2}$/.test(value) ? `${new Date(openedAt).getFullYear()}-${value.replace(".", "-")}` : value;
    return Date.parse(normalized) || 0;
  }
  function openDetail(project: Project, edit = false) {
    if (!isAdmin) return;
    setEditing(edit);
    setDetail({ id: project.id, name: project.name, scope: "监控与软件集成", owner_role: roleKeys[project.owner as Role] || "", created_at: "" });
    if (isAdmin) void localApi<ProjectDetail>(`/api/access/projects/${project.id}`).then(setDetail).catch((error) => setCreateError(error.message));
  }
  async function saveDetail() {
    if (!detail) return;
    setBusy(true); setCreateError("");
    try {
      await localApi(`/api/access/projects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ name: detail.name.trim(), scope: detail.scope, owner_role: detail.owner_role }) });
      dispatch({ type: "projectUpdate", id: detail.id, name: detail.name.trim(), owner: roleNames[detail.owner_role] as Role || state.role });
      setEditing(false); setDetail(null);
    } catch (error) { setCreateError(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  async function deleteDetail() {
    if (!detail || !window.confirm(`删除项目“${detail.name}”？项目将从当前列表隐藏，历史业务文件仍保留。`)) return;
    setBusy(true); setCreateError("");
    try {
      await localApi(`/api/access/projects/${detail.id}`, { method: "DELETE" });
      dispatch({ type: "projectDelete", id: detail.id }); setDetail(null);
    } catch (error) { setCreateError(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="projects-page">
      <div className="portal-title page-titlebar"><div><h1>项目</h1></div>{canCreateProject(state.role) && <button className="btn primary" onClick={() => setCreate(true)}><Plus size={16} />新建项目</button>}</div>
      <section data-tour="project-list" className="register-panel">
        <div className="project-toolbar"><div className="project-list-views"><button className={!onlyFollowed ? "active" : ""} onClick={() => setOnlyFollowed(false)}>全部项目</button><button className={onlyFollowed ? "active" : ""} onClick={() => setOnlyFollowed(true)}>我的关注</button></div><div className="library-search"><Search size={15} /><input value={query} aria-label="搜索项目" onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称或编号" /></div></div>
        <div className="dense-table-scroll"><table className="catalog-table project-register"><thead><tr><th>项目</th><th>范围</th><th>协调岗位</th><th>已写回环节</th><th>待复核变更</th><th>待处理</th><th>资料</th><th>更新</th><th>操作</th></tr></thead><tbody>
          {state.projects.filter((project) => `${project.name}${project.id}${project.owner}`.toLowerCase().includes(query.toLowerCase()) && (!onlyFollowed || followed.includes(project.id))).sort((a, b) => updateTime(b.updated) - updateTime(a.updated)).map((project) => {
            const snapshot = project.id === state.currentProjectId ? state : project.snapshot;
            const files = state.resources.filter((resource) => resource.projectId === project.id).length + projectFileCatalog.filter((resource) => resource.projectId === project.id && !state.resources.some((item) => item.path === resource.path)).length;
            return <tr key={project.id}>
              <td><div className="project-name-cell"><button className="project-follow" aria-label={(followed.includes(project.id) ? "取消关注 " : "关注 ") + project.name} aria-pressed={followed.includes(project.id)} onClick={() => toggleFollow(project.id)}><Star size={15} fill={followed.includes(project.id) ? "currentColor" : "none"} /></button><button className="file-open" disabled={state.running && project.id !== state.currentProjectId} onClick={() => { dispatch({ type: "projectSwitch", id: project.id }); navigate("/projects/" + project.id); }}>{project.name.replace(" · RCJM1", "")}<small>{project.id}</small></button></div></td>
              <td>{project.reference ? "BMS / DCIM / BA" : "监控与软件集成"}</td><td>{project.owner}</td>
              <td>{Object.values(snapshot?.stageStates || {}).filter((stage) => stage.written).length} / 13</td>
              <td>{projectChanges(state, project.id).filter((change) => change.status !== "已写回" && change.status !== "已完成").length}</td>
              <td>{project.reference ? rackIssues.length : state.followups.filter((followup) => followup.projectId === project.id && followup.status !== "done").length}</td>
              <td>{files}</td><td>{project.updated}</td>
              <td><div className="project-row-actions">{isAdmin && <><button onClick={() => openDetail(project)}>详情</button><button onClick={() => openDetail(project, true)}>编辑</button><button className="danger" onClick={() => { openDetail(project); window.setTimeout(() => { const element = document.querySelector<HTMLButtonElement>("[data-delete-project]"); element?.click(); }, 0); }}>删除</button></>}</div></td>
            </tr>;
          })}
        </tbody></table></div>
      </section>

      <Dialog open={create} onOpenChange={setCreate}><DialogContent><DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>创建独立项目空间，建立档案并归集本项目资料。</DialogDescription></DialogHeader>
        <label className="form-label">项目名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="form-label">协调岗位<select value={owner} onChange={(event) => setOwner(event.target.value as Role)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
        <button className="btn primary" disabled={!name.trim() || state.running || creating} onClick={async () => {
          if (creating) return; setCreating(true); setCreateError("");
          try {
            const id = "DEMO-" + randomId().slice(0, 6).toUpperCase();
            await localApi("/api/access/projects", { method: "POST", body: JSON.stringify({ id, name: name.trim(), scope: "监控与软件集成", owner_role: roleKeys[owner] }) });
            const person = await localApi<{ projects: { id: string; name: string }[] } & Record<string, unknown>>("/api/me"); sessionStorage.setItem("presales-person", JSON.stringify(person));
            dispatch({ type: "projectCreate", createdId: id, name, owner }); setCreate(false); setName("");
          } catch (error) { setCreateError(error instanceof Error ? error.message : "创建项目失败，请重试"); }
          finally { setCreating(false); }
        }}>{creating ? "正在创建…" : "创建项目"}</button>{createError && <FloatingNotice role="alert">{createError}</FloatingNotice>}
      </DialogContent></Dialog>

      {detail && <div className="access-overlay" onClick={() => { if (!busy) setDetail(null); }}><section className="access-drawer project-detail-drawer" role="dialog" aria-modal="true" aria-label="项目详情" onClick={(event) => event.stopPropagation()}><header><h2>{editing ? "编辑项目" : "项目详情"}</h2><button aria-label="关闭项目详情" onClick={() => setDetail(null)}>×</button></header><div className="access-drawer-body">
        {editing ? <><label className="form-label">项目名称<input value={detail.name} onChange={(event) => setDetail({ ...detail, name: event.target.value })} /></label><label className="form-label">项目范围<input value={detail.scope} onChange={(event) => setDetail({ ...detail, scope: event.target.value })} /></label><label className="form-label">协调岗位<select value={detail.owner_role} onChange={(event) => setDetail({ ...detail, owner_role: event.target.value })}>{roles.map((role) => <option value={roleKeys[role]} key={role}>{role}</option>)}</select></label></> : <dl className="project-detail-fields"><div><dt>项目名称</dt><dd>{detail.name}</dd></div><div><dt>项目编号</dt><dd>{detail.id}</dd></div><div><dt>项目范围</dt><dd>{detail.scope}</dd></div><div><dt>协调岗位</dt><dd>{roleNames[detail.owner_role] || detail.owner_role}</dd></div><div><dt>创建时间</dt><dd>{detail.created_at || "—"}</dd></div></dl>}
        <div className="project-detail-actions">{editing ? <button className="btn primary" disabled={busy || !detail.name.trim()} onClick={() => void saveDetail()}>保存修改</button> : <>{isAdmin && <button className="btn secondary" onClick={() => setEditing(true)}>编辑项目</button>}<button className="btn secondary" onClick={() => { dispatch({ type: "projectSwitch", id: detail.id }); navigate("/projects/" + detail.id); setDetail(null); }}>打开项目</button>{isAdmin && <button data-delete-project className="btn secondary danger" disabled={busy} onClick={() => void deleteDetail()}>删除项目</button>}</>}</div>
      </div></section></div>}
    </div>
  );
}
