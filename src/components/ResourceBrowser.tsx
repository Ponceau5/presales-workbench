import { FileFormatIcon } from '@/components/FileFormatIcon';
import { projectFileCatalog } from "@/lib/projectFileCatalog";
import { PointReader, DocumentReader } from "@/components/SourceReader";
import {SourceFigure} from "@/features/software/MarkdownReply";
import { localApi, localApiBase } from "@/lib/localApi";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FileText, Copy, Plus, Search, ArrowUpRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkbench } from "@/state/workbench";
import { fileHref, type ProjectResource } from "@/lib/portfolio";
export function ResourceBrowser({
  projectId,
  compact = false,
  resourceIds,
}: {
  projectId?: string;
  compact?: boolean;
  resourceIds?: string[];
}) {
  const { state, dispatch } = useWorkbench();
  const [storedDocuments,setStoredDocuments]=useState<(ProjectResource & {page_count:number})[]>([]);
  const [documentText,setDocumentText]=useState('');
  const [storageError,setStorageError]=useState('');
  async function loadDocuments(){const scope=projectId||filter;if(!scope||scope==='全部')return;const rows=await localApi<{id:string;title:string;filename:string;version:string;created_at:string;page_count:number;category?:string}[]>(`/api/projects/${encodeURIComponent(scope)}/documents`);setStoredDocuments(rows.map(r=>({id:r.id,page_count:r.page_count,projectId:scope,title:r.title,version:r.version,format:r.filename.split('.').pop()?.toUpperCase()||'',kind:r.category==='template'?'工件模板':'原始资料',path:`/api/documents/${r.id}/download`,source:'项目共享池',folder:r.category==='template'?'工件模板':r.id.startsWith('intake-')?'F7 F8 必要资料':'项目上传',summary:r.filename,modified:r.created_at.slice(0,10)})));}
  useEffect(()=>{void loadDocuments().catch(e=>setStorageError(e.message));const refresh=()=>void loadDocuments().catch(e=>setStorageError(e.message));window.addEventListener('project-materials-updated',refresh);return()=>window.removeEventListener('project-materials-updated',refresh);},[projectId]);
  const allResources = [
    ...storedDocuments,
    ...state.resources.map((r) => ({
      ...projectFileCatalog.find((f) => f.path === r.path),
      ...r,
    })),
    ...projectFileCatalog.filter(
      (r) => !state.resources.some((k) => k.path === r.path),
    ),
  ];
  const [aux, setAux] = useState(false);
  const [format, setFormat] = useState("全部"),
    [sort, setSort] = useState("更新时间"),
    [page, setPage] = useState(0);
  const pageSize = 50;
  const projectFiles = allResources.filter(
    (r) => state.projects.some(p=>p.id===r.projectId) && (!projectId || r.projectId === projectId),
  );
  const classify = (r: ProjectResource) => {
    if (r.kind === "工件模板") return "工件模板";
    if (r.kind === "项目笔记") return "项目档案";
    if (r.id.includes("PTC") || /PTC|clarif|澄清/i.test(r.title))
      return "澄清记录";
    if (
      r.id.includes("POINT") ||
      r.id.includes("CONFIG") ||
      r.id.includes("BA") ||
      /point|点表|配置|configuration/i.test(r.title)
    )
      return "点表与配置";
    if (r.kind === "工件") return "成果工件";
    if (
      /spec|规格|requirement|SOO|控制序列/i.test(r.title) ||
      /spec|规格/i.test(r.folder || "")
    )
      return "规格与要求";
    if (
      ["DWG", "IFC", "BAK", "DWL", "DWL2"].includes(r.format) ||
      /draw|图纸|drawing/i.test(r.folder || r.title)
    )
      return "图纸";
    return "项目档案";
  };
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(projectId || "全部");
  const [opened, setOpened] = useState<ProjectResource | null>(null);
  useEffect(()=>{setDocumentText('');if(opened&&storedDocuments.some(d=>d.id===opened.id&&d.page_count>0)){void localApi<{text:string}>(`/api/documents/${opened.id}/pages/1`).then(p=>setDocumentText(p.text)).catch(e=>setStorageError(e.message));}},[opened?.id]);
  async function downloadStored(id:string){setStorageError('');try{const value=await localApi<{url:string}>(`/api/documents/${id}/download-link`);if(value.url)window.location.assign(value.url);else{const response=await fetch(localApiBase+`/api/documents/${id}/download`,{headers:{Authorization:'Bearer '+sessionStorage.getItem('presales-local-api-token')}});if(!response.ok)throw new Error('下载失败');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=storedDocuments.find(d=>d.id===id)?.summary||'原件';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){setStorageError(e instanceof Error?e.message:'下载失败');}}
  const [copied, setCopied] = useState(false);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [file,setFile]=useState<File|null>(null);
  const [uploading,setUploading]=useState(false);
  const [summary, setSummary] = useState("");
  const [version, setVersion] = useState("");
  const [kind, setKind] = useState<ProjectResource["kind"]>("原始资料");
  const [project, setProject] = useState(projectId || state.projects[0].id);
  const resources = allResources
    .filter(
      (r) =>
        (filter === "全部" || r.projectId === filter) &&
        (aux || !["BAK", "DWL", "DWL2", "LOG", "DB"].includes(r.format)) &&
        (format === "全部" || r.format === format) &&
        (category === "全部" || classify(r) === category) &&
        (!resourceIds || resourceIds.includes(r.id)) &&
        `${r.title}${r.summary}${r.version}${r.path}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "更新时间"
        ? (b.modified || b.version).localeCompare(a.modified || a.version)
        : sort === "大小"
          ? (b.size || 0) - (a.size || 0)
          : a.title.localeCompare(b.title, "zh-CN"),
    );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(resources.length / pageSize) - 1),
  );
  return (
    <section className="resource-index">
      {storageError&&<p role="alert" className="gsa-chat-error">{storageError}</p>}
      <div className="resource-toolbar">
        <h2>
          资料与工件{" "}
          <span>
            {projectFiles.length} 份 ·{" "}
            {(
              projectFiles.reduce((n, r) => n + (r.size || 0), 0) /
              1024 /
              1024 /
              1024
            ).toFixed(2)}{" "}
            GB
          </span>
        </h2>
        <div>
          <div className="index-search">
            <Search size={14} />
            <input
              aria-label="搜索项目资料"
              placeholder="搜索资料与工件"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {!projectId && (
            <select
              aria-label="筛选资料所属项目"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option>全部</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn mini" onClick={() => setCreate(true)}>
            <Plus size={14} />
            登记资料
          </button>
        </div>
      </div>
      <div className="project-files-workspace">
        <aside className="file-folder-tree">      <div className="resource-category-tree">
        {[
          "全部",
          "项目档案",
          "规格与要求",
          "图纸",
          "点表与配置",
          "澄清记录",
          "成果工件",
          "工件模板",
        ].map((k) => (
          <button
            key={k}
            className={category === k ? "active" : ""}
            onClick={() => {
              setCategory(k);
              setPage(0);
            }}
          >
            {k}{" "}
            <small>
              {
                allResources.filter(
                  (r) =>
                    (!projectId || r.projectId === projectId) &&
                    (k === "全部" || classify(r) === k),
                ).length
              }
            </small>
          </button>
        ))}
      </div>
</aside>
        <div className="project-files-main">
          <div className="catalog-tools">
            <strong>{category === "全部" ? "项目文件" : category}</strong>
            <select
              aria-label="文件格式"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                setPage(0);
              }}
            >
              {["全部", ...new Set(projectFiles.map((r) => r.format))].map(
                (f) => (
                  <option key={f}>{f}</option>
                ),
              )}
            </select>
            <select
              aria-label="文件排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {["名称", "更新时间", "大小"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <label className="aux-file-toggle">
              <input
                type="checkbox"
                checked={aux}
                onChange={(e) => {
                  setAux(e.target.checked);
                  setPage(0);
                }}
              />
              辅助文件
            </label>
            <span>{resources.length} 个结果</span>
          </div>
          <div className="dense-table-scroll">
            <table className="catalog-table project-resource-table">
              <thead>
                <tr>
                  <th>资料 / 工件</th>
                  <th>版本</th>
                  <th>格式</th>
                  <th>大小</th>
                  <th>更新</th>
                  <th>目录</th>
                </tr>
              </thead>
              <tbody>
                {resources
                  .slice(
                    compact ? 0 : safePage * pageSize,
                    compact ? 5 : (safePage + 1) * pageSize,
                  )
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="file-open"
                          title={r.title}
                          onClick={() => {
                            setOpened(r);
                            setCopied(false);
                          }}
                        >
                          <FileFormatIcon format={r.format} />
                          <span>{r.title}</span>
                        </button>
                      </td>
                      <td>{r.version}</td>
                      <td>{r.format}</td>
                      <td>
                        {r.size
                          ? r.size < 1024 * 1024
                            ? (r.size / 1024).toFixed(0) + " KB"
                            : (r.size / 1024 / 1024).toFixed(1) + " MB"
                          : "—"}
                      </td>
                      <td>{r.modified || "—"}</td>
                      <td title={r.folder || r.source}>
                        {r.folder || r.source}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!compact && (
            <div className="table-pagination">
              <span>
                {resources.length ? safePage * pageSize + 1 : 0}–
                {Math.min((safePage + 1) * pageSize, resources.length)} /{" "}
                {resources.length}
              </span>
              <button
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                上一页
              </button>
              <span>
                {safePage + 1} /{" "}
                {Math.max(1, Math.ceil(resources.length / pageSize))}
              </span>
              <button
                disabled={(safePage + 1) * pageSize >= resources.length}
                onClick={() => setPage(safePage + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>
      {!resources.length && <p className="index-empty">没有匹配的资料。</p>}
      {compact && resources.length > 5 && (
        <Link className="index-more" to="/library">
          查看全部 {resources.length} 份资料 <ArrowUpRight size={13} />
        </Link>
      )}
      <Dialog
        open={!!opened}
        onOpenChange={(v) => {
          if (!v) setOpened(null);
        }}
      >
        <DialogContent
          className={
            "resource-dialog " +
            (["RC-POINT", "RC-SPEC", "RC-SOO", "RC-DCOM"].includes(
              opened?.id || "",
            )
              ? "source-reader-dialog"
              : "")
          }
        >
          <DialogHeader>
            <DialogTitle>{opened?.title}</DialogTitle>
            <DialogDescription>
              {opened?.projectId} · {opened?.kind} · {opened?.version}
            </DialogDescription>
          </DialogHeader>
          <p>{opened?.summary}</p>
          {opened?.id === "RC-POINT" && <PointReader />}
          {opened?.id === "RC-SPEC" && <DocumentReader document="bms-spec" />}
          {opened?.id === "RC-SOO" && (
            <DocumentReader document="control-sequence" />
          )}
          {opened?.id === "RC-DCOM" && (
            <DocumentReader document="dcom-requirements" />
          )}
          {opened&&storedDocuments.some(d=>d.id===opened.id)&&<section className="stored-source-preview"><button className="btn primary" onClick={()=>void downloadStored(opened.id)}>下载原件</button>{['PNG','JPG','JPEG','WEBP','GIF','BMP'].includes(opened.format)?<SourceFigure src={`/api/documents/${opened.id}/figures/1`} label={opened.title}/>:<pre>{documentText||(storedDocuments.find(d=>d.id===opened.id)?.page_count?'正在读取资料…':'已保存原件，暂无可预览正文')}</pre>}</section>}
          {!storedDocuments.some(d=>d.id===opened?.id)&&<>
          <div className="resource-source">
            <FileText size={15} />
            {opened?.source}
          </div>
          {opened?.path ? (
            <>
              {opened&&!storedDocuments.some(d=>d.id===opened.id)&&<details className="source-location">
                <summary>活文件位置</summary>
                <label className="form-label">
                  活文件位置
                  <textarea rows={4} value={opened.path} readOnly />
                </label>
              </details>}
              <div className="actions">
                <button
                  className="btn primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(opened.path);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  <Copy size={14} />
                  {copied ? "路径已复制" : "复制路径"}
                </button>
                <a className="btn secondary" href={fileHref(opened.path)}>
                  活文件链接
                  <ArrowUpRight size={14} />
                </a>
              </div>
              <small className="muted">
                浏览器可能限制本地文件链接，可复制路径到 Finder 打开。
              </small>
            </>
          ) : (
            <Link
              className="btn primary"
              to={opened?.id === "DEMO-ARTIFACT" ? "/software" : "/stages/F2"}
              onClick={() => {
                dispatch({
                  type: "projectSwitch",
                  id: opened?.projectId || "DEMO-026",
                });
                setOpened(null);
              }}
            >
              打开工作区
              <ArrowUpRight size={14} />
            </Link>
          )}</>}
        </DialogContent>
      </Dialog>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记项目资料</DialogTitle>
            <DialogDescription>
              保留项目归属、内容说明与有效版本。
            </DialogDescription>
          </DialogHeader>
          <div className="form-row">
            <label className="form-label">
              所属项目
              <select
                value={project}
                disabled={!!projectId}
                onChange={(e) => setProject(e.target.value)}
              >
                {state.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              类型
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as ProjectResource["kind"])
                }
              >
                {["原始资料", "工件模板"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-label">
            名称
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="form-label">
            版本
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <label className="form-label">本地文件<input type="file" aria-label="上传项目资料文件" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);if(next&&!title)setTitle(next.name);if(!version)setVersion('V1');}}/></label>
          {kind==='工件模板'&&<p className="muted">上传空白或已确认格式的模板。Skill 可按名称和版本引用其列名、占位符和输出结构，示例数据不会作为项目事实。</p>}
          <label className="form-label">
            内容说明
            <textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <button
            className="btn primary"
            disabled={uploading||!file||!title.trim()||!version.trim()}
            onClick={async()=>{if(!file)return;setUploading(true);setStorageError('');try{const body=new FormData();body.append('file',file);body.append('title',title.trim());body.append('version',version.trim());body.append('archive_mode',kind==='工件模板'?'template':'input');body.append('stage_id','*');body.append('usage',summary);await localApi(`/api/projects/${encodeURIComponent(project)}/documents`,{method:'POST',body});await loadDocuments();setCreate(false);setFile(null);setTitle('');setSummary('');setVersion('');}catch(e){setStorageError(e instanceof Error?e.message:'上传失败');}finally{setUploading(false);}}}
          >{uploading?'正在上传…':'上传并登记'}</button>{storageError&&<p role="alert">{storageError}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
