import {FloatingNotice} from "@/components/FloatingNotice";
import {ResourceImportDialog} from "@/components/ResourceImportDialog";
import { FileFormatIcon } from "@/components/FileFormatIcon";
import { projectFileCatalog } from "@/lib/projectFileCatalog";
import { ResourceDetail, type ResourceDetailModel, type ResourceVersion } from "@/components/ResourceDetail";
import { localApi, localApiBase } from "@/lib/localApi";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Plus, Search, ArrowUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkbench } from "@/state/workbench";
import { fileHref, type ProjectResource } from "@/lib/portfolio";

type StoredDocument = ProjectResource & { page_count: number; filename: string; disabled: boolean; analysis_status: string; analysis_error: string; business_type: string };
type StoredArtifact = ProjectResource & { stage_id: string; content: string; disabled: boolean; replacement_id?: string; specialized?: boolean; sizing?: boolean };
type DocumentRow = { id: string; title: string; filename: string; version: string; created_at: string; page_count: number; category?: string; analysis_status?: string; analysis_summary?: string; analysis_error?: string; business_type?: string; origin_stage?: string };
type ArtifactRow = { id: string; title: string; revision: number; stage_id: string; content: string; adopted_by: string; created_at: string; disabled?: boolean; replacement_id?: string; specialized?: boolean; sizing?: boolean };
type Analysis = { status: string; summary: string; error: string };

function nextVersion(version: string) {
  const numbers = [...version.matchAll(/[vV](\d+)/g)].map((match) => Number(match[1]));
  return `V${numbers.length ? Math.max(...numbers) + 1 : 2}`;
}

export function ResourceBrowser({ projectId, compact = false, resourceIds }: { projectId?: string; compact?: boolean; resourceIds?: string[] }) {
  const { state } = useWorkbench();
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([]);
  const [storedArtifacts, setStoredArtifacts] = useState<StoredArtifact[]>([]);
  const [storageError, setStorageError] = useState("");
  const [filter, setFilter] = useState(projectId || "全部");
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("全部");
  const [sort, setSort] = useState("更新时间");
  const [page, setPage] = useState(0);
  const [aux, setAux] = useState(false);
  const [opened, setOpened] = useState<ProjectResource | null>(null);
  const [create, setCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget,setDeleteTarget] = useState<StoredDocument | StoredArtifact | null>(null);
  const [updateTarget, setUpdateTarget] = useState<StoredDocument | StoredArtifact | null>(null);
  const [updateFile, setUpdateFile] = useState<File | null>(null);
  const pageSize = 50;

  const loadDocuments = useCallback(() => {
    const scope = projectId || filter;
    if (!scope || scope === "全部") return Promise.resolve();
    return localApi<DocumentRow[]>(`/api/projects/${encodeURIComponent(scope)}/documents`).then(rows => {
    setStoredDocuments(rows.map((row) => ({
      id: row.id, page_count: row.page_count, filename: row.filename, projectId: scope,
      title: row.title, version: row.version, format: row.filename.split(".").pop()?.toUpperCase() || "",
      kind: row.category === "template" ? "工件模板" : "原始资料",
      path: `/api/documents/${row.id}/download`, source: row.origin_stage ? `${row.origin_stage} 工作区` : "项目共享池",
      folder: row.category === "template" ? "工件模板" : row.id.startsWith("intake-") ? "F7 F8 必要资料" : "项目上传",
      summary: row.analysis_summary || row.filename, modified: row.created_at.slice(0, 10),
      disabled: row.category === "disabled", analysis_status: row.analysis_status || "missing", analysis_error: row.analysis_error || "", business_type: row.business_type || "",
    })));
    });
  }, [projectId, filter]);

  const loadArtifacts = useCallback(() => {
    const scope = projectId || filter;
    if (!scope || scope === "全部") return Promise.resolve();
    return localApi<ArtifactRow[]>(`/api/projects/${encodeURIComponent(scope)}/artifacts`).then(rows => {
    setStoredArtifacts(rows.map((row) => ({
      id: row.id, projectId: scope, title: row.title, version: `V${row.revision}`, format: "MD", kind: "工件",
      path: row.sizing ? `/api/projects/${scope}/software/runs/${row.id}/export?format=md` : row.specialized ? `/api/projects/${scope}/software/artifacts/${row.id}/download?format=md` : `/api/projects/${scope}/workspaces/${row.stage_id}/artifacts/${row.id}/download?format=md`,
      source: `${row.stage_id} 工作区`, folder: "成果工件", summary: row.content,
      modified: row.created_at.slice(0, 10), stage_id: row.stage_id, content: row.content, disabled: !!row.disabled, replacement_id: row.replacement_id,
    })));
    });
  }, [projectId, filter]);

  const refresh = useCallback(() => Promise.all([loadDocuments(), loadArtifacts()])
    .then(() => setStorageError(""))
    .catch(error => setStorageError(error instanceof Error ? error.message : "资料读取失败")),
    [loadDocuments, loadArtifacts]);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener("project-materials-updated", listener);
    return () => window.removeEventListener("project-materials-updated", listener);
  }, [refresh]);

  useEffect(() => {
    if (!opened || !storedDocuments.some((doc) => doc.id === opened.id)) return;
    const current = storedDocuments.find((doc) => doc.id === opened.id)!;
    if (!["queued", "running"].includes(current.analysis_status)) return;
    const timer = window.setInterval(() => {
      void localApi<Analysis>(`/api/documents/${opened.id}/analysis`).then((analysis) => {
        setStoredDocuments((rows) => rows.map((row) => row.id === opened.id ? { ...row, analysis_status: analysis.status, analysis_error: analysis.error, summary: analysis.summary || row.filename } : row));
        if (!["queued", "running"].includes(analysis.status)) window.clearInterval(timer);
      }).catch(() => window.clearInterval(timer));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [opened, storedDocuments]);

  const allResources: ProjectResource[] = [
    ...storedDocuments.filter((doc) => !doc.disabled),
    ...storedArtifacts.filter(artifact => !artifact.disabled),
    ...state.resources.map((resource) => ({ ...projectFileCatalog.find((file) => file.path === resource.path), ...resource })),
    ...projectFileCatalog.filter((resource) => !state.resources.some((item) => item.path === resource.path)),
  ];
  const projectFiles = allResources.filter((resource) => state.projects.some((project) => project.id === resource.projectId) && (!projectId || resource.projectId === projectId));
  const classify = (resource: ProjectResource) => {
    const stored = storedDocuments.find((doc) => doc.id === resource.id);
    if (stored?.business_type) return stored.business_type;
    if (resource.kind === "工件模板") return "工件模板";
    if (resource.kind === "项目笔记") return "项目档案";
    if (resource.id.includes("PTC") || /PTC|clarif|澄清/i.test(resource.title)) return "澄清记录";
    if (resource.id.includes("POINT") || resource.id.includes("CONFIG") || resource.id.includes("BA") || /point|点表|配置|configuration/i.test(resource.title)) return "点表与配置";
    if (resource.kind === "工件") return "成果工件";
    if (/spec|规格|requirement|SOO|控制序列/i.test(resource.title) || /spec|规格/i.test(resource.folder || "")) return "规格与要求";
    if (["DWG", "IFC", "BAK", "DWL", "DWL2"].includes(resource.format) || /draw|图纸|drawing/i.test(resource.folder || resource.title)) return "图纸";
    return "项目档案";
  };
  const resources = allResources.filter((resource) =>
    (filter === "全部" || resource.projectId === filter) &&
    (aux || !["BAK", "DWL", "DWL2", "LOG", "DB"].includes(resource.format)) &&
    (format === "全部" || resource.format === format) &&
    (category === "全部" || classify(resource) === category) &&
    (!resourceIds || resourceIds.includes(resource.id)) &&
    `${resource.title}${resource.summary}${resource.version}${resource.path}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => sort === "更新时间" ? (b.modified || b.version).localeCompare(a.modified || a.version) : sort === "大小" ? (b.size || 0) - (a.size || 0) : a.title.localeCompare(b.title, "zh-CN"));
  const safePage = Math.min(page, Math.max(0, Math.ceil(resources.length / pageSize) - 1));
  const openedDocument = storedDocuments.find((doc) => doc.id === opened?.id);
  const openedArtifact = storedArtifacts.find((artifact) => artifact.id === opened?.id);

  function detailModel(): ResourceDetailModel | null {
    if (!opened) return null;
    if (openedDocument) {
      const versions = storedDocuments.filter((doc) => doc.projectId === openedDocument.projectId && doc.title === openedDocument.title)
        .sort((a, b) => b.modified!.localeCompare(a.modified!) || b.version.localeCompare(a.version, undefined, { numeric: true }))
        .map((doc) => ({ id: doc.id, version: doc.version, downloadPath: `/api/documents/${doc.id}/download`, filename: doc.filename }));
      return { id: openedDocument.id, title: openedDocument.title, type: classify(openedDocument), updatedAt: openedDocument.modified || "—", source: openedDocument.source,
        summary: openedDocument.analysis_status === "ready" ? openedDocument.summary : (openedDocument.analysis_error ? '暂无概要。' : '') || (openedDocument.analysis_status === "missing" ? "尚未生成概要，可重试生成，无需重新上传。" : "Agent 正在生成概要，请稍候。"),
        version: openedDocument.version, versions: [...versions, ...storedArtifacts.filter(a => a.replacement_id === openedDocument.id || (a.projectId === openedDocument.projectId && a.title === openedDocument.title && a.disabled)).map(a => ({id:a.id,version:a.version,downloadPath:a.path,filename:`${a.title}_${a.version}.md`}))] };
    }
    if (openedArtifact) {
      const versions = storedArtifacts.filter((artifact) => artifact.projectId === openedArtifact.projectId && artifact.title === openedArtifact.title)
        .map((artifact) => ({ id: artifact.id, version: artifact.version, downloadPath: artifact.path, filename: `${artifact.title}_${artifact.version}.md` }));
      return { id: openedArtifact.id, title: openedArtifact.title, type: "成果工件", updatedAt: openedArtifact.modified || "—", source: openedArtifact.source, summary: openedArtifact.content, version: openedArtifact.version, versions };
    }
    return { id: opened.id, title: opened.title, type: opened.kind, updatedAt: opened.modified || "—", source: opened.source, summary: opened.summary || "暂无 Agent 概要。", version: opened.version,
      versions: [{ id: opened.id, version: opened.version, downloadPath: opened.path, filename: opened.title }] };
  }

  async function download(version: ResourceVersion) {
    setStorageError("");
    try {
      if (!storedDocuments.some((doc) => doc.id === version.id) && !storedArtifacts.some((artifact) => artifact.id === version.id)) {
        window.location.assign(fileHref(version.downloadPath));
        return;
      }
      const response = await fetch(localApiBase + version.downloadPath, { headers: { Authorization: "Bearer " + sessionStorage.getItem("presales-local-api-token") } });
      if (!response.ok) throw new Error("下载失败");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = version.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setStorageError(error instanceof Error ? error.message : "下载失败"); }
  }

  async function confirmDelete() {
    if(!deleteTarget)return;setUploading(true);setStorageError("");
    try {
      await localApi("stage_id" in deleteTarget ? `/api/projects/${encodeURIComponent(deleteTarget.projectId)}/artifacts/${deleteTarget.id}/disable` : `/api/documents/${deleteTarget.id}/disable`,{method:"POST"});
      setStoredDocuments(rows=>rows.filter(row=>row.id!==deleteTarget.id));setStoredArtifacts(rows=>rows.filter(row=>row.id!==deleteTarget.id));
      setOpened(null);setDeleteTarget(null);window.dispatchEvent(new Event("project-materials-updated"));
    } catch(error){setStorageError(error instanceof Error?error.message:"删除失败，请重试");}finally{setUploading(false);}
  }
  const model = detailModel();
  return (
    <section className="resource-index">
      {openedDocument?.analysis_error&&<FloatingNotice>{openedDocument.analysis_error}</FloatingNotice>}
      {storageError && <FloatingNotice role="alert" className="gsa-chat-error">{storageError}</FloatingNotice>}
      <div className="resource-toolbar"><h2>资料与工件 <span>{projectFiles.length} 份 · {(projectFiles.reduce((total, resource) => total + (resource.size || 0), 0) / 1024 / 1024 / 1024).toFixed(2)} GB</span></h2><div><div className="index-search"><Search size={14} /><input aria-label="搜索项目资料" placeholder="搜索资料与工件" value={query} onChange={(event) => setQuery(event.target.value)} /></div>{!projectId && <select aria-label="筛选资料所属项目" value={filter} onChange={(event) => setFilter(event.target.value)}><option>全部</option>{state.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>}<button className="btn mini" onClick={() => setCreate(true)}><Plus size={14} />登记资料</button></div></div>
      <div className="project-files-workspace"><aside className="file-folder-tree"><div className="resource-category-tree">{["全部", "项目档案", "规格与要求", "图纸", "点表与配置", "澄清记录", "成果工件", "工件模板"].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => { setCategory(item); setPage(0); }}>{item} <small>{allResources.filter((resource) => (!projectId || resource.projectId === projectId) && (item === "全部" || classify(resource) === item)).length}</small></button>)}</div></aside>
        <div className="project-files-main"><div className="catalog-tools"><strong>{category === "全部" ? "项目文件" : category}</strong><select aria-label="文件格式" value={format} onChange={(event) => { setFormat(event.target.value); setPage(0); }}>{["全部", ...new Set(projectFiles.map((resource) => resource.format))].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="文件排序" value={sort} onChange={(event) => setSort(event.target.value)}>{["名称", "更新时间", "大小"].map((item) => <option key={item}>{item}</option>)}</select><label className="aux-file-toggle"><input type="checkbox" checked={aux} onChange={(event) => { setAux(event.target.checked); setPage(0); }} />辅助文件</label><span>{resources.length} 个结果</span></div>
          <div className="dense-table-scroll"><table className="catalog-table project-resource-table"><thead><tr><th>资料 / 工件</th><th>版本</th><th>格式</th><th>大小</th><th>更新</th><th>目录</th></tr></thead><tbody>{resources.slice(compact ? 0 : safePage * pageSize, compact ? 5 : (safePage + 1) * pageSize).map((resource) => <tr key={resource.id}><td><button className="file-open" title={resource.title} onClick={() => setOpened(resource)}><FileFormatIcon format={resource.format} /><span>{resource.title}</span></button></td><td>{resource.version}</td><td>{resource.format}</td><td>{resource.size ? resource.size < 1024 * 1024 ? (resource.size / 1024).toFixed(0) + " KB" : (resource.size / 1024 / 1024).toFixed(1) + " MB" : "—"}</td><td>{resource.modified || "—"}</td><td title={resource.folder || resource.source}>{resource.folder || resource.source}</td></tr>)}</tbody></table></div>
          {!compact && <div className="table-pagination"><span>{resources.length ? safePage * pageSize + 1 : 0}–{Math.min((safePage + 1) * pageSize, resources.length)} / {resources.length}</span><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage + 1} / {Math.max(1, Math.ceil(resources.length / pageSize))}</span><button disabled={(safePage + 1) * pageSize >= resources.length} onClick={() => setPage(safePage + 1)}>下一页</button></div>}
        </div>
      </div>
      {!resources.length && <p className="index-empty">没有匹配的资料。</p>}
      {compact && resources.length > 5 && <Link className="index-more" to="/library">查看全部 {resources.length} 份资料 <ArrowUpRight size={13} /></Link>}

      <Dialog open={!!opened} onOpenChange={(value) => { if (!value) setOpened(null); }}><DialogContent className="resource-dialog">{model && <ResourceDetail model={model} onRetrySummary={openedDocument && ['failed','missing'].includes(openedDocument.analysis_status) ? async () => {setUploading(true);setStorageError('');try {const result=await localApi<{error?:string}>(`/api/documents/${openedDocument.id}/analysis/retry`,{method:'POST'});if(result.error)setStorageError(result.error);await loadDocuments();}catch(error){setStorageError(error instanceof Error?error.message:'概要重试失败');}finally{setUploading(false);}} : undefined} onDownload={download} onUpdate={openedDocument || openedArtifact ? () => { setUpdateTarget(openedDocument || openedArtifact!); setUpdateFile(null); } : undefined} onDelete={openedDocument || openedArtifact ? () => {setStorageError("");setDeleteTarget(openedDocument || openedArtifact!);} : undefined} busy={uploading} />}</DialogContent></Dialog>

      <Dialog open={!!updateTarget} onOpenChange={(value) => { if (!value) setUpdateTarget(null); }}><DialogContent><DialogHeader><DialogTitle>更新资料</DialogTitle></DialogHeader>
        <p><strong>新版本：</strong>{updateTarget ? nextVersion(updateTarget.version) : ""}</p>
        <label className="form-label">新文件<input aria-label="上传更新资料文件" type="file" onChange={(event) => setUpdateFile(event.target.files?.[0] || null)} /></label>
        <button className="btn primary" disabled={uploading || !updateFile} onClick={async () => {
          if (!updateTarget || !updateFile) return; setUploading(true); setStorageError("");
          try { const body = new FormData(); body.append("file", updateFile); await localApi("stage_id" in updateTarget ? `/api/projects/${encodeURIComponent(updateTarget.projectId)}/artifacts/${updateTarget.id}` : `/api/documents/${updateTarget.id}`, { method: "PUT", body }); await refresh(); window.dispatchEvent(new Event("project-materials-updated")); setUpdateTarget(null); setUpdateFile(null); setOpened(null); }
          catch (error) { setStorageError(error instanceof Error ? error.message : "更新失败"); }
          finally { setUploading(false); }
        }}>{uploading ? "正在更新…" : "确认更新"}</button>
      </DialogContent></Dialog>

      <ResourceImportDialog open={create} onOpenChange={setCreate} projectId={projectId || (filter !== "全部" ? filter : state.projects[0]?.id) || ""} projectName={state.projects.find(item=>item.id === (projectId || (filter !== "全部" ? filter : state.projects[0]?.id)))?.name || ""} onImported={async()=>{await loadDocuments();window.dispatchEvent(new Event("project-materials-updated"));}} />
      <Dialog open={!!deleteTarget} onOpenChange={value=>{if(!value&&!uploading)setDeleteTarget(null);}}><DialogContent><DialogHeader><DialogTitle>删除“{deleteTarget?.title}”？</DialogTitle></DialogHeader><div className="actions"><button className="btn secondary" disabled={uploading} onClick={()=>setDeleteTarget(null)}>取消</button><button className="btn primary" disabled={uploading} onClick={()=>void confirmDelete()}>{uploading?"正在删除…":"确认删除"}</button></div></DialogContent></Dialog>

    </section>
  );
}
