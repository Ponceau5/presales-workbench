import { projectFileCatalog } from "@/lib/projectFileCatalog";
import { rackIssues } from "@/lib/portfolio";
import { projectChanges } from "@/lib/projectChanges";
import { canCreateProject } from "@/lib/accounts";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Search, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkbench } from "@/state/workbench";
import { roles } from "@/lib/workspace";
export default function Projects() {
  const { state, dispatch } = useWorkbench();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const followKey = `presales-followed-projects:${state.accountId || 'guest'}`;
  const [followed, setFollowed] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(followKey)||'[]');}catch{return [];}});
  const [onlyFollowed,setOnlyFollowed]=useState(false);
  function toggleFollow(id:string){const next=followed.includes(id)?followed.filter(v=>v!==id):[...followed,id];localStorage.setItem(followKey,JSON.stringify(next));setFollowed(next);}
  function updateTime(value:string){if(value==='刚刚')return Date.now();const normalized=/^\d{2}\.\d{2}$/.test(value)?`${new Date().getFullYear()}-${value.replace('.','-')}`:value;return Date.parse(normalized)||0;}
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<string>(state.role);
  return (
    <div className="projects-page">
      <div className="portal-title page-titlebar">
        <div>
          <h1>项目</h1>
        </div>
        {canCreateProject(state.role) && (
          <button
            className="btn primary"
            disabled={!canCreateProject(state.role)}
            onClick={() => setCreate(true)}
          >
            <Plus size={16} />
            新建项目
          </button>
        )}
      </div>
      <section data-tour="project-list" className="register-panel"><div className="project-toolbar"><div className="project-list-views"><button className={!onlyFollowed?'active':''} onClick={()=>setOnlyFollowed(false)}>全部项目</button><button className={onlyFollowed?'active':''} onClick={()=>setOnlyFollowed(true)}>我的关注</button></div>
        <div className="library-search">
          <Search size={15} />
          <input
            value={query}
            aria-label="搜索项目"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目名称或编号"
          />
        </div>
      </div>
      <div className="dense-table-scroll">
        <table className="catalog-table project-register">
          <thead>
            <tr>
              <th>项目</th>
              <th>范围</th>
              <th>协调岗位</th>
              <th>已写回环节</th>
              <th>待复核变更</th>
              <th>待处理</th>
              <th>资料</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {state.projects
              .filter((p) => `${p.name}${p.id}${p.owner}`.toLowerCase().includes(query.toLowerCase()) && (!onlyFollowed || followed.includes(p.id)))
              .sort((a,b)=>updateTime(b.updated)-updateTime(a.updated))
              .map((p) => {
                const snapshot =
                  p.id === state.currentProjectId ? state : p.snapshot;
                const files =
                  state.resources.filter((r) => r.projectId === p.id).length +
                  projectFileCatalog.filter(
                    (r) =>
                      r.projectId === p.id &&
                      !state.resources.some((k) => k.path === r.path),
                  ).length;
                return (
                  <tr key={p.id}>
                    <td><div className="project-name-cell"><button className="project-follow" aria-label={(followed.includes(p.id)?'取消关注 ':'关注 ')+p.name} aria-pressed={followed.includes(p.id)} onClick={()=>toggleFollow(p.id)}><Star size={15} fill={followed.includes(p.id)?'currentColor':'none'}/></button>
                      <button
                        className="file-open"
                        disabled={
                          state.running && p.id !== state.currentProjectId
                        }
                        onClick={() => {
                          dispatch({ type: "projectSwitch", id: p.id });
                          navigate("/projects/" + p.id);
                        }}
                      >
                        {p.name.replace(" · RCJM1", "")}
                        <small>{p.id}</small>
                      </button></div>
                    </td>
                    <td>
                      {p.reference ? "BMS / DCIM / BA" : "监控与软件集成"}
                    </td>
                    <td>{p.owner}</td>
                    <td>
                      {
                        Object.values(snapshot?.stageStates || {}).filter(
                          (s) => s.written,
                        ).length
                      }{" "}
                      / 13
                    </td>
                    <td>
                      {
                        projectChanges(state, p.id).filter(
                          (c) => c.status !== "已写回" && c.status !== "已完成",
                        ).length
                      }
                    </td>
                    <td>
                      {p.reference
                        ? rackIssues.length
                        : state.followups.filter(
                            (f) => f.projectId === p.id && f.status !== "done",
                          ).length}
                    </td>
                    <td>{files}</td>
                    <td>{p.updated}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      </section>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              创建独立项目空间；原型载入标准演示资料，可分别跟进。
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            项目名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="form-label">
            协调岗位
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <button
            className="btn primary"
            disabled={!name.trim() || state.running}
            onClick={() => {
              dispatch({ type: "projectCreate", name, owner });
              setCreate(false);
              setName("");
            }}
          >
            创建项目
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
