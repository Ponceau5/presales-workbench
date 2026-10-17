import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { Search, UsersRound, FolderKey, ShieldCheck, History, X, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { currentPerson, localApi, localApiBase } from '@/lib/localApi';
import './access-management.css';
import ProjectAccessPanel from './ProjectAccessPanel';

export type AccessUser = { id: string; display_name: string; role: string; is_admin: number; active: number };
type User = AccessUser;
type Owner = { project_id: string; role: string; user_id: string; revision: number };
export type AccessData = { users: User[]; projects: { id: string; name: string }[]; owners: Owner[]; members: { project_id: string; user_id: string }[]; roles: Record<string, string>; role_stages: Record<string, string[]>; permissions: Record<string, Record<string, { assigned: boolean; source: string; owner_roles: string[]; read: boolean; trial: boolean; apply: boolean; publish: boolean; process_stages: string[] }>> };
type Data = AccessData;
type Event = { id: string; actor: string; action: string; detail: string; created_at: string };
type External = { id: string; name: string; display_name: string; linked: boolean; active: boolean };
type Tab = 'users' | 'projects' | 'roles' | 'events';
const tabs = [{ id: 'projects', name: '项目授权', icon: FolderKey }, { id: 'users', name: '人员与岗位', icon: UsersRound }, { id: 'roles', name: '岗位权限', icon: ShieldCheck }, { id: 'events', name: '变更记录', icon: History }] as const;
const actions: Record<string, string> = { user_created: '创建账号', user_active_changed: '调整账号状态', user_renamed: '修改账号', user_profile_changed: '修改用户资料', owner_assigned: '分配负责人', project_visibility_changed: '调整项目可见范围', project_created: '创建项目', identity_linked: '添加工作台账号' };

export default function AccessManagement() {
  const person = currentPerson();
  const admin = !!person?.is_admin;
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('users');
  const [project, setProject] = useState('');
  const [role, setRole] = useState('sales');
  const [query, setQuery] = useState('');
  const [scopeQuery, setScopeQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', display_name: '', role: 'sales', password: '' });
  const [profile, setProfile] = useState({ display_name: '', role: 'sales' });
  const [events, setEvents] = useState<Event[]>([]);
  const [identity, setIdentity] = useState<{ enabled: boolean; admin_url: string } | null>(null);
  const [external, setExternal] = useState<External[] | null>(null);
  const [externalName, setExternalName] = useState('');

  async function load() { setData(await localApi<Data>('/api/access/overview')); }
  useEffect(() => {
    if (!admin) return;
    void load().catch(e => setError(e.message));
    void fetch(localApiBase + '/api/auth/config').then(r => { if (!r.ok) throw Error('无法读取账号服务'); return r.json(); }).then(setIdentity).catch(e => setError(e.message));
  }, [admin]);
  useEffect(() => {
    if (admin && tab === 'events') void localApi<Event[]>('/api/access/events').then(setEvents).catch(e => setError(e.message));
  }, [admin, tab]);
  useEffect(() => {
    if (!editing) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setEditing(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [editing, busy]);
  async function mutate(url: string, method: string, value: unknown) {
    setBusy(true); setError('');
    try { await localApi(url, { method, body: JSON.stringify(value) }); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }
  function openUser(user: User) { setEditing(user.id); setScopeQuery(''); setProfile({ display_name: user.display_name, role: user.role }); setError(''); }
  async function syncAccounts() {
    setBusy(true); setError('');
    try { setExternal(await localApi<External[]>('/api/auth/casdoor/accounts')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (!admin) return <Navigate to="/" replace />;
  if (!data) return <section className="access-management"><h1>权限管理</h1><p role="status">{error || '正在读取…'}</p></section>;
  const user = data.users.find(u => u.id === editing);
  const visibleProjects = (u: User) => u.is_admin ? data.projects : data.projects.filter(p => data.owners.some(o => o.project_id === p.id && o.user_id === u.id) || data.members.some(m => m.project_id === p.id && m.user_id === u.id));
  const filteredUsers = data.users.filter(u => (!query || (u.display_name + u.id).toLowerCase().includes(query.toLowerCase())) && (!roleFilter || u.role === roleFilter) && (!status || String(u.active) === status));
  const nameOf = (id: string) => data.users.find(u => u.id === id)?.display_name || id;
  const projectName = (id: string) => data.projects.find(p => p.id === id)?.name || id;
  function describe(event: Event) {
    try {
      const d = JSON.parse(event.detail);
      if (event.action === 'owner_assigned' && d.previous_user_id) return `${projectName(d.project)} · ${data!.roles[d.role]} · ${nameOf(d.previous_user_id)} → ${nameOf(d.user_id)}${d.retain_previous_access === true ? ' · 保留原负责人访问' : d.retain_previous_access === false ? ' · 撤销原负责人直接授权' : ''}`;
      if (event.action === 'user_renamed') return `${d.previous} → ${d.current}`;
      if (event.action === 'user_profile_changed') return `${nameOf(d.id)} · ${data!.roles[d.role]}`;
      return [d.project ? projectName(d.project) : '', d.user_id || d.id ? nameOf(d.user_id || d.id) : '', d.role ? data!.roles[d.role] : '', typeof d.active === 'boolean' ? d.active ? '启用' : '停用' : '', typeof d.visible === 'boolean' ? d.visible ? '可见' : '移除可见授权' : ''].filter(Boolean).join(' · ') || '—';
    } catch { return '—'; }
  }
  const toolbarSearch = <label className="access-search"><Search size={15} /><input aria-label="搜索用户" placeholder="搜索姓名或账号" value={query} onChange={e => setQuery(e.target.value)} /></label>;
  return <section className="access-management">
    <header className="access-header page-titlebar"><div><div className="access-breadcrumb">系统管理 / 权限管理</div><h1>权限管理</h1></div><span className="access-admin"><ShieldCheck size={14} />管理员</span></header>
    <div className="register-panel"><nav className="access-tabs" aria-label="权限管理分类">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => { setTab(t.id); setQuery(''); setError(''); }}><t.icon size={16} />{t.name}</button>)}</nav>
    {error && !editing && <p className="access-error" role="alert">{error}</p>}
    {tab === 'users' && <>
      <div className="access-toolbar"><div className="access-filters">{toolbarSearch}<select aria-label="按岗位筛选" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">全部岗位</option>{Object.entries(data.roles).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select><select aria-label="按状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option><option value="1">正常</option><option value="0">已停用</option></select></div><div className="access-actions">{identity?.enabled ? <><button disabled={busy} onClick={() => void syncAccounts()}><RefreshCw size={14} />添加已有账号</button></> : identity && <button className="primary" onClick={() => setCreating(!creating)}><Plus size={14} />新增用户</button>}</div></div>
      {external && <form className="access-create" onSubmit={e => { e.preventDefault(); void mutate('/api/auth/casdoor/link', 'POST', { name: externalName, role: form.role }).then(ok => { if (ok) { setExternal(null); setExternalName(''); } }); }}><label>账号<select required value={externalName} onChange={e => setExternalName(e.target.value)}><option value="">选择账号</option>{external.filter(u => !u.linked && u.active).map(u => <option key={u.id} value={u.name}>{u.display_name} · {u.name}</option>)}</select></label><label>岗位<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{Object.entries(data.roles).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label><div className="access-actions"><button disabled={busy || !externalName} className="primary">添加</button><button type="button" onClick={() => setExternal(null)}>取消</button></div>{!external.some(u => !u.linked && u.active) && <span className="access-muted">没有待添加的账号</span>}</form>}
      {creating && <form className="access-create" onSubmit={e => { e.preventDefault(); void mutate('/api/access/users', 'POST', form).then(ok => { if (ok) { setCreating(false); setForm({ username: '', display_name: '', role: 'sales', password: '' }); } }); }}><label>账号<input required pattern="[a-z][a-z0-9_-]{2,39}" autoComplete="off" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label><label>姓名<input required maxLength={80} value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></label><label>岗位<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{Object.entries(data.roles).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label><label>初始密码<input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label><div className="access-actions"><button className="primary" disabled={busy}>创建</button><button type="button" onClick={() => setCreating(false)}>取消</button></div></form>}
      <div className="access-table"><table><thead><tr><th>用户</th><th>岗位</th><th>项目范围</th><th>状态</th><th className="access-last">操作</th></tr></thead><tbody>{filteredUsers.map(u => <tr key={u.id}><td><button className="access-user" onClick={() => openUser(u)}><span className="access-avatar">{u.display_name.slice(0, 1)}</span><span>{u.display_name}<small>{u.id}</small></span>{u.is_admin ? <span className="access-tag">管理员</span> : null}</button></td><td>{data.roles[u.role]}</td><td className="access-project-names">{u.is_admin ? '全部项目' : <button className="access-link" onClick={() => openUser(u)}>{visibleProjects(u).length ? `${visibleProjects(u).length} 个项目` : '未授权'}<ChevronRight size={12}/></button>}</td><td><span className={'access-status ' + (u.active ? 'enabled' : '')}>{u.active ? '正常' : '已停用'}</span></td><td className="access-last"><button className="access-link" onClick={() => openUser(u)}>管理<ChevronRight size={13} /></button></td></tr>)}</tbody></table>{!filteredUsers.length && <div className="access-empty">没有匹配的用户</div>}<footer>共 {filteredUsers.length} 个用户</footer></div>
    </>}
    {tab === 'projects' && <ProjectAccessPanel data={data} project={project} setProject={setProject} busy={busy} mutate={mutate} openUser={openUser} error={error} />}
    {tab === 'roles' && <div className="access-split"><aside><h2>岗位</h2>{Object.entries(data.roles).map(([r, name]) => <button key={r} className={r === role ? 'active' : ''} onClick={() => setRole(r)}><span>{name}</span><span className="access-count">{data.users.filter(u => u.role === r).length}</span></button>)}</aside><div className="access-project-detail"><h2>{data.roles[role]}</h2><h3>可操作工作区</h3><div className="access-stage-list">{(data.role_stages[role] || []).map(s => <span className="access-stage" key={s}>{s}</span>)}{!data.role_stages[role]?.length && <span className="access-muted">无岗位工作区</span>}</div><h3>权限规则</h3><div className="access-table"><table><tbody><tr><th>项目资料</th><td>{role==='admin'?'全部项目':'仅限已授权项目'}</td></tr><tr><th>正式业务操作</th><td>{role==='admin'?'全部工作区': '由项目对应岗位负责人执行'}</td></tr><tr><th>工作区 Skill 调试</th><td>{role === 'admin' ? '全部工作区' : '本岗位工作区；个人草稿独立试运行'}</td></tr><tr><th>公共 Skill 发布</th><td>仅管理员</td></tr><tr><th>管理员</th><td>可管理全部项目及账号权限</td></tr></tbody></table></div><p className="access-muted access-caption">工作区规则由系统定义；人员岗位和项目范围在用户、项目授权中调整。</p><h3>岗位成员</h3><div className="access-member-list">{data.users.filter(u => u.role === role).map(u => <button key={u.id} onClick={() => openUser(u)}><span className="access-avatar">{u.display_name.slice(0, 1)}</span>{u.display_name}<span className={'access-status ' + (u.active ? 'enabled' : '')}>{u.active ? '正常' : '已停用'}</span></button>)}</div></div></div>}
    {tab === 'events' && <div className="access-table access-events"><table><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>内容</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{new Date(e.created_at).toLocaleString('zh-CN', { hour12: false })}</td><td>{nameOf(e.actor)}</td><td>{actions[e.action] || '权限变更'}</td><td>{describe(e)}</td></tr>)}</tbody></table>{!events.length && <div className="access-empty">暂无权限变更</div>}<footer>最近 100 条</footer></div>}
    {user && <div className="access-overlay" onClick={() => { if (!busy) setEditing(null); }}><section className="access-drawer access-person-drawer" role="dialog" aria-modal="true" aria-labelledby="access-user-title" onClick={e => e.stopPropagation()}><header><div><h2 id="access-user-title">{user.display_name}</h2><span className="access-muted">{user.id}</span></div><button aria-label="关闭用户详情" disabled={busy} onClick={() => setEditing(null)}><X size={18} /></button></header><div className="access-drawer-body">{error && <p role="alert" className="access-error">{error}</p>}<form className="access-user-form" onSubmit={e => { e.preventDefault(); void mutate('/api/access/users/' + encodeURIComponent(user.id) + '/profile', 'PATCH', profile); }}><label>姓名<input required maxLength={80} value={profile.display_name} onChange={e => setProfile({ ...profile, display_name: e.target.value })} /></label><label>岗位<select value={profile.role} onChange={e => setProfile({ ...profile, role: e.target.value })}>{Object.entries(data.roles).map(([r, n]) => <option key={r} value={r}>{n}</option>)}</select></label><button className="primary" disabled={busy || (profile.display_name === user.display_name && profile.role === user.role)}>保存</button></form><div className="access-section-heading"><h3>工作台访问</h3><button disabled={busy || user.id === person?.id} onClick={() => void mutate('/api/access/users/' + encodeURIComponent(user.id), 'PATCH', { active: !user.active })}>{user.active ? '停用' : '启用'}</button></div><span className={'access-status ' + (user.active ? 'enabled' : '')}>{user.active ? '正常' : '已停用'}</span><div className="access-section-heading"><h3>项目权限</h3><button onClick={() => { setEditing(null); setTab('projects'); setProject(visibleProjects(user)[0]?.id || data.projects[0]?.id || ''); }}>按项目管理</button></div><label className="access-search access-scope-search"><Search size={14}/><input placeholder="搜索授权项目" aria-label="搜索授权项目" value={scopeQuery} onChange={e=>setScopeQuery(e.target.value)}/></label><div className="access-table user-access-table"><table><thead><tr><th>项目</th><th>身份 / 来源</th><th>Skill 调试</th><th>应用流程</th></tr></thead><tbody>{visibleProjects(user).filter(p=>(p.name+p.id).toLowerCase().includes(scopeQuery.toLowerCase())).map(p => {const permission=data.permissions?.[user.id]?.[p.id];return <tr key={p.id}><td><button className="access-link" onClick={()=>{setProject(p.id);setTab('projects');setEditing(null);}}>{p.name}</button></td><td>{user.is_admin?'系统管理员':permission?.owner_roles.length?'岗位负责人':'项目参与者'}</td><td>{permission?.trial?'允许':'—'}</td><td>{permission?.apply?'允许':'—'}</td></tr>;})}</tbody></table>{!visibleProjects(user).length&&<div className="access-empty">未分配项目</div>}</div></div></section></div>}
    </div>
  </section>;
}
