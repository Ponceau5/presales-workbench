import { projectFileCatalog } from "@/lib/projectFileCatalog";
import { PointReader, DocumentReader } from "@/components/SourceReader";
import { useState } from "react";
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
  const allResources = [
    ...state.resources.map((r) => ({
      ...projectFileCatalog.find((f) => f.path === r.path),
      ...r,
    })),
    ...projectFileCatalog.filter(
      (r) => !state.resources.some((k) => k.path === r.path),
    ),
  ];
  const [aux, setAux] = useState(false);
  const [folder, setFolder] = useState("全部"),
    [format, setFormat] = useState("全部"),
    [sort, setSort] = useState("更新时间"),
    [page, setPage] = useState(0);
  const pageSize = 50;
  const folderRoot = (r: ProjectResource) =>
    !r.folder ? "重点资料" : r.folder === "." ? "根目录" : r.folder;
  const isInFolder = (r: ProjectResource, f: string) =>
    f === "全部" || folderRoot(r) === f || folderRoot(r).startsWith(f + "/");
  const projectFiles = allResources.filter(
    (r) => !projectId || r.projectId === projectId,
  );
  const classify = (r: ProjectResource) => {
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
  const [copied, setCopied] = useState(false);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState("");
  const [version, setVersion] = useState("");
  const [kind, setKind] = useState<ProjectResource["kind"]>("原始资料");
  const [project, setProject] = useState(projectId || state.projects[0].id);
  const resources = allResources
    .filter(
      (r) =>
        (filter === "全部" || r.projectId === filter) &&
        isInFolder(r, folder) &&
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
  const directories = [...new Set(projectFiles.map((r) => folderRoot(r)))];
  const childFolders = [
    ...new Set(
      directories
        .filter((f) => folder === "全部" || f.startsWith(folder + "/"))
        .map((f) =>
          folder === "全部"
            ? f.split("/")[0]
            : folder + "/" + f.slice(folder.length + 1).split("/")[0],
        ),
    ),
  ];
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(resources.length / pageSize) - 1),
  );
  return (
    <section className="resource-index">
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
      <div className="resource-categories">
        {[
          "全部",
          "项目档案",
          "规格与要求",
          "图纸",
          "点表与配置",
          "澄清记录",
          "成果工件",
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
      <div className="project-files-workspace">
        <aside className="file-folder-tree">
          <button
            className={folder === "全部" ? "active" : ""}
            onClick={() => {
              setFolder("全部");
              setPage(0);
            }}
          >
            全部目录 <small>{projectFiles.length}</small>
          </button>
          {folder !== "全部" && (
            <button
              onClick={() => {
                setFolder(
                  folder.includes("/")
                    ? folder.slice(0, folder.lastIndexOf("/"))
                    : "全部",
                );
                setPage(0);
              }}
            >
              ← 上级目录
            </button>
          )}
          {childFolders.map((f) => (
            <button
              title={f}
              className={folder === f ? "active" : ""}
              key={f}
              onClick={() => {
                setFolder(f);
                setPage(0);
              }}
            >
              <span>{f.split("/").at(-1)}</span>
              <small>
                {projectFiles.filter((r) => isInFolder(r, f)).length}
              </small>
            </button>
          ))}
        </aside>
        <div className="project-files-main">
          <div className="catalog-tools">
            <strong>{folder === "全部" ? "项目文件" : folder}</strong>
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
                          <FileText size={15} />
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
          <div className="resource-source">
            <FileText size={15} />
            {opened?.source}
          </div>
          {opened?.path ? (
            <>
              <details className="source-location">
                <summary>活文件位置</summary>
                <label className="form-label">
                  活文件位置
                  <textarea rows={4} value={opened.path} readOnly />
                </label>
              </details>
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
          )}
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
                {["原始资料", "工件", "项目笔记"].map((k) => (
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
          <label className="form-label">
            本地路径
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/…"
            />
          </label>
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
            disabled={
              !title.trim() ||
              !version.trim() ||
              !path.startsWith("/") ||
              !summary.trim()
            }
            onClick={() => {
              dispatch({
                type: "resource",
                item: {
                  id: crypto.randomUUID(),
                  projectId: project,
                  title: title.trim(),
                  kind,
                  format:
                    path.split(".").pop()?.toUpperCase().slice(0, 5) || "文件",
                  version: version.trim(),
                  summary: summary.trim(),
                  path,
                  source:
                    state.role + "登记 · " + new Date().toLocaleDateString(),
                },
              });
              setCreate(false);
              setTitle("");
              setPath("");
              setSummary("");
              setVersion("");
            }}
          >
            保存资料索引
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
