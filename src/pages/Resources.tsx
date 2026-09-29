import { useState } from "react";
import { Link } from "react-router";
import { Search, FileText, Copy, ExternalLink } from "lucide-react";
import { sharedCatalog } from "@/lib/sharedCatalog";
import { PdfPreview } from "@/components/PdfPreview";
import { fileHref } from "@/lib/portfolio";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const previews: Record<string, { path: string; pages: number }> = {
  "英文-宣传册": { path: "/shared/cet-profile.pdf", pages: 47 },
  "BMS Software Architecture-Linux": {
    path: "/shared/bms-linux.pdf",
    pages: 5,
  },
  "BMS Software Architecture-Windows": {
    path: "/shared/bms-windows.pdf",
    pages: 2,
  },
  "Description of N+2 Architecture": {
    path: "/shared/n-plus-two.pdf",
    pages: 5,
  },
};
export default function Resources() {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState("全部"),
    [query, setQuery] = useState(""),
    [product, setProduct] = useState("全部"),
    [language, setLanguage] = useState("全部"),
    [opened, setOpened] = useState<(typeof sharedCatalog)[number] | null>(null),
    [copied, setCopied] = useState(false);
  const categories = ["全部", ...new Set(sharedCatalog.map((r) => r.category))];
  const visible = sharedCatalog.filter(
    (r) =>
      (category === "全部" || r.category === category) &&
      (product === "全部" || r.product === product) &&
      (language === "全部" || r.language === language) &&
      `${r.title} ${r.location} ${r.product}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / 50) - 1),
  );
  return (
    <div className="catalog-page">
      <header className="catalog-heading">
        <h1>
          公共资料 <small>{sharedCatalog.length}</small>
        </h1>
        <Link to="/methods">方法与经验 →</Link>
      </header>
      <div className="catalog-workspace">
        <aside className="catalog-tree">
          {categories.map((c) => (
            <button
              className={c === category ? "active" : ""}
              key={c}
              onClick={() => {
                setCategory(c);
                setPage(0);
              }}
            >
              {c}
              <span>
                {
                  sharedCatalog.filter((r) => c === "全部" || r.category === c)
                    .length
                }
              </span>
            </button>
          ))}
        </aside>
        <section className="catalog-main">
          <div className="catalog-tools">
            <label className="inbox-search">
              <Search size={15} />
              <input
                aria-label="搜索公共资料"
                placeholder="名称、产品、目录"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="产品线"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              {["全部", ...new Set(sharedCatalog.map((r) => r.product))].map(
                (p) => (
                  <option key={p}>{p}</option>
                ),
              )}
            </select>
            <select
              aria-label="资料语言"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {["全部", "中文", "英文", "未标注"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <span>{visible.length} 份</span>
          </div>
          <div className="dense-table-scroll">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>资料名称</th>
                  <th>产品</th>
                  <th>类型</th>
                  <th>语言</th>
                  <th>格式</th>
                  <th>更新日期</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(safePage * 50, (safePage + 1) * 50).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button
                        className="file-open"
                        onClick={() => {
                          setOpened(r);
                          setCopied(false);
                        }}
                      >
                        <FileText size={15} />
                        {r.title}
                      </button>
                    </td>
                    <td>{r.product}</td>
                    <td>{r.category}</td>
                    <td>{r.language}</td>
                    <td>{r.format}</td>
                    <td>{r.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-pagination">
            <span>
              {visible.length ? safePage * 50 + 1 : 0}–
              {Math.min((safePage + 1) * 50, visible.length)} / {visible.length}
            </span>
            <button
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              上一页
            </button>
            <span>
              {safePage + 1} / {Math.max(1, Math.ceil(visible.length / 50))}
            </span>
            <button
              disabled={(safePage + 1) * 50 >= visible.length}
              onClick={() => setPage(safePage + 1)}
            >
              下一页
            </button>
          </div>
          {!visible.length && <p className="index-empty">没有匹配资料</p>}
        </section>
      </div>
      <Dialog
        open={!!opened}
        onOpenChange={(v) => {
          if (!v) setOpened(null);
        }}
      >
        <DialogContent
          className={
            opened && previews[opened.title]
              ? "source-reader-dialog"
              : "resource-dialog"
          }
        >
          <DialogHeader>
            <DialogTitle>{opened?.title}</DialogTitle>
            <DialogDescription>
              {opened?.category} · {opened?.product} · {opened?.format} ·{" "}
              {opened?.language}
            </DialogDescription>
          </DialogHeader>
          {opened && previews[opened.title] ? (
            <PdfPreview {...previews[opened.title]} />
          ) : (
            <div className="file-detail">
              <dl>
                <dt>目录</dt>
                <dd>{opened?.location}</dd>
                <dt>更新</dt>
                <dd>{opened?.updated}</dd>
              </dl>
              <label className="form-label">
                活文件位置
                <textarea rows={3} readOnly value={opened?.path || ""} />
              </label>
              <div className="actions">
                <button
                  className="btn secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(opened?.path || "");
                    setCopied(true);
                  }}
                >
                  <Copy size={14} />
                  {copied ? "已复制" : "复制路径"}
                </button>
                <a className="btn primary" href={fileHref(opened?.path || "")}>
                  <ExternalLink size={14} />
                  打开活文件
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
