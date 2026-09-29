import {
  loadShared,
  mergeShared,
  saveShared,
  sharedKey,
} from "@/lib/sharedWorkspace";
import type { Action } from "@/state/workbench";
import { PersonalTasks } from "@/components/PersonalTasks";
import Login from "@/pages/Login";
import Activity from "@/pages/Activity";
import { accounts } from "@/lib/accounts";
import { clearLocalApiSession } from "@/lib/localApi";
import KnowledgeLibrary from "@/pages/KnowledgeLibrary";
import Resources from "@/pages/Resources";
import { ProjectAssistant } from "@/components/ProjectAssistant";
import "./workspace.css";
import "./workbench-refinement.css";
import { useEffect, useCallback, useRef, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  Link,
  useLocation,
  Navigate,
  useParams,
} from "react-router";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Layers3,
  FolderOpen,
  SlidersHorizontal,
  LayoutDashboard,
  Files,
  Sun,
  Moon,
  ChevronDown,
  UsersRound,
  X,
} from "lucide-react";
import { pipelineSteps, loadSettings } from "@/lib/presales";
import { roles } from "@/lib/workspace";
import Home from "@/pages/Home";
import Portal from "@/pages/Portal";
import Projects from "@/pages/Projects";
import ChangeImpact from "@/pages/ChangeImpact";
import Settings from "@/pages/Settings";
import {
  WorkbenchContext,
  initialState,
  reducer,
  useWorkbench,
} from "@/state/workbench";
function StageRedirect() {
  const { id } = useParams();
  const { state } = useWorkbench();
  return (
    <Navigate
      replace
      to={
        "/projects/" +
        state.currentProjectId +
        "?view=review&stage=" +
        (id || "F1")
      }
    />
  );
}
export default function App() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [state, setState] = useState(() => {
    const s = initialState(loadSettings());
    try {
      const saved = JSON.parse(
        localStorage.getItem("presales-ui-preferences") || "{}",
      );
      if (saved.theme === "dark") s.theme = "dark";
      if (roles.includes(saved.role)) s.role = saved.role;
    } catch {
      /* Default appearance. */
    }
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("presales-workspace-v1") || "null",
      );
      if (saved?.projects && saved?.rows && saved?.activity)
        Object.assign(s, saved, { settings: loadSettings(), running: false });
      const account = accounts.find((a) => a.id === s.accountId);
      if (account) s.role = account.role;
      else s.accountId = null;
    } catch {
      /* Use the local baseline. */
    }
    return mergeShared(s, loadShared());
  });
  const stateRef = useRef(state);
  const dispatch = useCallback((action: Action) => {
    if (action.type === "logout" && !stateRef.current.running) clearLocalApiSession();
    const current = mergeShared(stateRef.current, loadShared());
    const next = reducer(current, action);
    stateRef.current = next;
    if (
      ![
        "theme",
        "bookmark",
        "login",
        "logout",
        "settings",
        "dismissPermission",
        "hydrateShared",
        "projectSwitch",
      ].includes(action.type) &&
      next !== current
    ) {
      try {
        saveShared(next);
      } catch {
        /* Remain usable in memory. */
      }
    }
    setState(next);
  }, []);
  useEffect(() => {
    if (!loadShared()) saveShared(stateRef.current);
    const update = (event: StorageEvent) => {
      if (event.key !== sharedKey) return;
      const next = mergeShared(stateRef.current, loadShared());
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  useEffect(() => {
    try {
      const snapshot = { ...state };
      delete (snapshot as Partial<typeof state>).settings;
      sessionStorage.setItem(
        "presales-workspace-v1",
        JSON.stringify({ ...snapshot, running: false }),
      );
    } catch {
      /* Continue in memory. */
    }
  }, [state]);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    try {
      localStorage.setItem(
        "presales-ui-preferences",
        JSON.stringify({ role: state.role, theme: state.theme }),
      );
    } catch {
      /* Preferences remain in memory. */
    }
  }, [state.theme, state.role]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const project =
    state.projects.find((p) => p.id === location.pathname.split("/")[2]) ||
    state.projects.find((p) => p.id === state.currentProjectId)!;
  const nav = [
    { to: "/", label: "项目监控", icon: LayoutDashboard },
    { to: "/tasks", label: "我的任务", icon: UsersRound },
    { to: "/projects", label: "项目", icon: FolderOpen },
    { to: "/library", label: "公共资料", icon: Files },
    { to: "/settings", label: "连接设置", icon: SlidersHorizontal },
    { to: "/activity", label: "操作记录", icon: Files },
  ];
  const inProject = ![
    "/",
    "/projects",
    "/settings",
    "/library",
    "/methods",
    "/activity",
    "/tasks",
  ].includes(location.pathname);
  const [projectTabs, setProjectTabs] = useState<{
    path: string;
    ids: string[];
  }>({ path: "", ids: [] });
  if (projectTabs.path !== location.pathname) {
    setProjectTabs({
      path: location.pathname,
      ids:
        inProject && !projectTabs.ids.includes(project.id)
          ? [...projectTabs.ids, project.id]
          : projectTabs.ids,
    });
  }
  const openedProjects = projectTabs.ids;
  const [collapsedProjects, setCollapsedProjects] = useState<
    Record<string, boolean>
  >({});
  async function runAgent(ids?: string[]) {
    if (
      busy.current ||
      !state.accountId ||
      !["软件产品", "研发", "解决方案"].includes(state.role)
    )
      return;
    busy.current = true;
    dispatch({ type: "start", ids });
    const steps = [
      "读取 · 技术规格书与能力基线",
      "提取 · 拆解原则、接入与功能要求",
      "匹配 · 关联能力依据与缺项",
      "计算 / 转换 · 生成应答、澄清、路径和规格",
      "差异高亮 · 定位视频与部署变化",
      "等待人审 · 工件进入评审队列",
    ];
    for (const message of steps) {
      dispatch({ type: "event", message });
      await new Promise<void>((resolve) => {
        timer.current = setTimeout(resolve, 380);
      });
    }
    dispatch({ type: "finish", ids });
    busy.current = false;
  }
  if (!state.accountId)
    return (
      <WorkbenchContext.Provider value={{ state, dispatch, runAgent }}>
        <Login />
      </WorkbenchContext.Provider>
    );
  return (
    <WorkbenchContext.Provider value={{ state, dispatch, runAgent }}>
      <div
        className={
          "app-shell" +
          (sidebarCollapsed ? " sidebar-collapsed" : "") +
          (location.pathname === "/" ? " portfolio-shell" : "")
        }
      >
        <aside className="sidebar">
          <Link className="brand" to="/">
            <span className="brand-mark">
              <Layers3 size={22} />
            </span>
            <span>售前工作台</span>
          </Link>
          <div className="workspace-label">工作空间</div>
          <nav>
            {nav
              .filter((n) => n.to !== "/settings" || state.role === "PM / PO")
              .map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  title={n.label}
                  aria-label={n.label}
                  end={n.to === "/" || n.to === "/projects"}
                  className={({ isActive }) =>
                    isActive ? "nav-item active" : "nav-item"
                  }
                >
                  <n.icon size={18} />
                  <span>{n.label}</span>
                  {n.to === "/tasks" &&
                    state.deliveries.some(
                      (d) =>
                        d.owner === state.role &&
                        ((d.status === "pending" && !d.outdated) ||
                          (d.status === "accepted" && d.outdated)),
                    ) && (
                      <b className="nav-receipt-count">
                        {
                          state.deliveries.filter(
                            (d) =>
                              d.owner === state.role &&
                              ((d.status === "pending" && !d.outdated) ||
                                (d.status === "accepted" && d.outdated)),
                          ).length
                        }
                      </b>
                    )}
                </NavLink>
              ))}
          </nav>
          <div className="workspace-label">已打开项目</div>
          {openedProjects.map((id) => {
            const p = state.projects.find((p) => p.id === id);
            if (!p) return null;
            return (
              <div
                className={
                  "project-tree " +
                  (collapsedProjects[id] ? "collapsed" : "expanded")
                }
                key={id}
              >
                <header>
                  <button
                    className="project-collapse"
                    aria-label={
                      (collapsedProjects[id] ? "展开 " : "收起 ") +
                      p.name +
                      "流程"
                    }
                    aria-expanded={!collapsedProjects[id]}
                    onClick={() =>
                      setCollapsedProjects((c) => ({ ...c, [id]: !c[id] }))
                    }
                  >
                    <ChevronDown size={13} />
                  </button>
                  <Link
                    to={"/projects/" + id}
                    onClick={() => {
                      dispatch({ type: "projectSwitch", id });
                    }}
                  >
                    {p.name.replace(" · " + id, "")}
                    <small>{id}</small>
                  </Link>
                  <button
                    aria-label={"关闭项目 " + p.name}
                    onClick={(e) => {
                      e.preventDefault();
                      setProjectTabs((t) => ({
                        ...t,
                        ids: t.ids.filter((x) => x !== id),
                      }));
                    }}
                  >
                    <X size={13} />
                  </button>
                </header>
                {!collapsedProjects[id] && (
                  <nav>
                    {pipelineSteps
                      .filter((s) => s.id !== "F14")
                      .map((s) => (
                        <Link
                          key={s.id}
                          to={"/projects/" + id + "?view=flow&stage=" + s.id}
                          onClick={() =>
                            dispatch({ type: "projectSwitch", id })
                          }
                          className={
                            project.id === id &&
                            location.pathname.endsWith("/" + s.id)
                              ? "active"
                              : ""
                          }
                        >
                          <span>{s.id}</span>
                          {s.label}
                        </Link>
                      ))}
                  </nav>
                )}
              </div>
            );
          })}
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="sidebar-toggle"
                aria-label={sidebarCollapsed ? "展开菜单栏" : "收起菜单栏"}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                )}
              </button>
              <Link to="/">项目监控</Link>
              {inProject ? (
                <>
                  <span>/</span>
                  <Link to={"/projects/" + project.id}>{project.name}</Link>
                </>
              ) : null}
            </div>
            <div className="toolbar-controls">
              <ProjectAssistant />
              <span className="account-badge">
                <UsersRound size={14} />
                {state.role}
                <small>{state.accountId}</small>
              </span>
              <button
                className="account-logout"
                disabled={state.running}
                onClick={() => dispatch({ type: "logout" })}
              >
                退出
              </button>
              <button
                className="theme-toggle"
                aria-label={
                  state.theme === "light" ? "切换暗色模式" : "切换亮色模式"
                }
                onClick={() =>
                  dispatch({
                    type: "theme",
                    theme: state.theme === "light" ? "dark" : "light",
                  })
                }
              >
                {state.theme === "light" ? (
                  <Moon size={17} />
                ) : (
                  <Sun size={17} />
                )}
              </button>
            </div>
          </header>
          <div className="mobile-nav">
            {nav
              .filter((n) => n.to !== "/settings" || state.role === "PM / PO")
              .map((n) => (
                <NavLink
                  key={n.to}
                  end={n.to === "/" || n.to === "/projects"}
                  to={n.to}
                >
                  {n.label}
                </NavLink>
              ))}
          </div>
          <main>
            {state.permissionNotice && (
              <div className="permission-notice" role="alert">
                {state.permissionNotice}
                <button onClick={() => dispatch({ type: "dismissPermission" })}>
                  关闭
                </button>
              </div>
            )}
            <Routes>
              <Route path="/activity" element={<Activity />} />
              <Route path="/tasks" element={<PersonalTasks />} />

              <Route path="/" element={<Portal key={location.search} />} />
              <Route path="/library" element={<Resources />} />
              <Route
                path="/methods"
                element={<KnowledgeLibrary key={location.search} />}
              />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:projectId" element={<Home />} />
              <Route path="/stages/:id" element={<StageRedirect />} />
              <Route
                path="/software"
                element={
                  <Navigate
                    replace
                    to={
                      "/projects/" +
                      state.currentProjectId +
                      "?view=review&stage=F5"
                    }
                  />
                }
              />
              <Route path="/changes" element={<ChangeImpact />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Portal key={location.search} />} />
            </Routes>
          </main>
        </div>
      </div>
    </WorkbenchContext.Provider>
  );
}
