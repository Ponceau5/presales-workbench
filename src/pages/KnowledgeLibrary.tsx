import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  Search,
  Plus,
  ShieldCheck,
  Bookmark,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkbench } from "@/state/workbench";
import { type Knowledge } from "@/lib/workspace";
import { Tag } from "@/components/WorkbenchUI";
const categories = [
  "全部",
  "方法与规则",
  "能力资料",
  "模板",
  "项目经验",
  "待审核",
];
export default function Portal() {
  const { state, dispatch } = useWorkbench();
  const [query, setQuery] = useState("");
  const [searchParams] = useSearchParams();
  const [category, setCategory] = useState(
    searchParams.get("knowledge") === "pending" ? "待审核" : "全部",
  );
  const [reviewNote, setReviewNote] = useState("");
  const [opened, setOpened] = useState<Knowledge | null>(null);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<Knowledge["category"]>("项目经验");
  const [permission, setPermission] = useState(false);
  const bookmarks = state.bookmarks[state.role] || [];
  const visible = useMemo(
    () =>
      state.knowledge.filter(
        (k) =>
          (category === "待审核"
            ? k.status === "pending"
            : k.status === "approved" &&
              (category === "全部" || k.category === category)) &&
          `${k.title}${k.summary}${k.owner}${k.content}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [state.knowledge, category, query],
  );
  const activeDoc = state.knowledge.find((k) => k.id === opened?.id);
  function publish() {
    dispatch({
      type: "knowledge",
      item: {
        id: crypto.randomUUID(),
        title,
        summary,
        content,
        category: kind,
        owner: state.role,
        version: "V1",
        updated: "刚刚",
        status: "pending",
        scope: "内部共享",
        related: [],
      },
    });
    setCreate(false);
    setTitle("");
    setSummary("");
    setContent("");
    setPermission(false);
    setCategory("待审核");
    setQuery("");
  }
  return (
    <div className="portal">
      <div className="portal-title">
        <div>
          <h1>
            方法与模板{" "}
            <span className="catalog-count">
              {state.knowledge.filter((k) => k.status === "approved").length}
            </span>
          </h1>
        </div>
        <button className="btn primary" onClick={() => setCreate(true)}>
          <Plus size={16} />
          共享知识
        </button>
      </div>
      <section className="knowledge-library">
        <div className="library-heading">
          <div className="library-search">
            <Search size={15} />
            <input
              aria-label="搜索共享知识"
              placeholder="搜索资料、模板、经验"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="library-filters">
          {categories.map((c) => (
            <button
              key={c}
              className={c === category ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
              {c === "待审核" ? (
                <span>
                  {state.knowledge.filter((k) => k.status === "pending").length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="dense-table-scroll">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>分类</th>
                <th>版本</th>
                <th>维护岗位</th>
                <th>更新</th>
                <th>收藏</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((k) => (
                <tr key={k.id}>
                  <td>
                    <button
                      className="file-open"
                      onClick={() => {
                        setOpened(k);
                        setReviewNote("");
                      }}
                    >
                      {k.title}
                    </button>
                  </td>
                  <td>{k.category}</td>
                  <td>{k.version}</td>
                  <td>{k.owner}</td>
                  <td>{k.updated}</td>
                  <td>
                    <button
                      className="file-open"
                      aria-label={
                        (bookmarks.includes(k.id) ? "取消收藏 " : "收藏 ") +
                        k.title
                      }
                      onClick={() => dispatch({ type: "bookmark", id: k.id })}
                    >
                      <Bookmark
                        size={13}
                        fill={
                          bookmarks.includes(k.id) ? "currentColor" : "none"
                        }
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length ? (
          <div className="empty-state">没有匹配的知识，试试其他关键词。</div>
        ) : null}
      </section>
      <Dialog
        open={!!opened}
        onOpenChange={(v) => {
          if (!v) setOpened(null);
        }}
      >
        <DialogContent className="knowledge-reader">
          <DialogHeader>
            <div className="reader-label">
              {activeDoc?.category} · {activeDoc?.version}
            </div>
            <DialogTitle>{activeDoc?.title}</DialogTitle>
            <DialogDescription>
              {activeDoc?.owner} · 更新于 {activeDoc?.updated} ·{" "}
              {activeDoc?.status === "approved" ? "已审核" : "待审核"}
            </DialogDescription>
          </DialogHeader>
          <div className="reader-content">
            {activeDoc?.content.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {activeDoc?.related.length ? (
            <div className="reader-related">
              <span>相关流程</span>
              {activeDoc.related.map((id) => (
                <Link
                  key={id}
                  to={
                    id === "F5"
                      ? "/software"
                      : id === "F14"
                        ? "/changes"
                        : "/stages/" + id
                  }
                  onClick={() => setOpened(null)}
                >
                  {id}
                  <ArrowUpRight size={12} />
                </Link>
              ))}
            </div>
          ) : null}
          {activeDoc?.reviewNote ? (
            <div className="knowledge-review">
              <p>
                {activeDoc.approvedBy} ·{" "}
                {activeDoc.approvedAt
                  ? new Date(activeDoc.approvedAt).toLocaleString()
                  : ""}
              </p>
              <p>{activeDoc.reviewNote}</p>
            </div>
          ) : null}
          {activeDoc?.status === "pending" ? (
            <div className="knowledge-review">
              <p>待维护人确认内容准确性及内部复用权限。</p>
              {state.role === "PM / PO" ? (
                <>
                  <label className="form-label">
                    审核意见
                    <input
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="准确性、来源与内部复用权限"
                    />
                  </label>
                  <button
                    className="btn primary"
                    disabled={!reviewNote.trim()}
                    onClick={() =>
                      dispatch({
                        type: "knowledgeApprove",
                        id: activeDoc.id,
                        note: reviewNote,
                      })
                    }
                  >
                    <ShieldCheck size={15} />
                    批准进入共享库
                  </button>
                </>
              ) : (
                <Tag tone="amber">PM / PO 待审核</Tag>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>共享知识</DialogTitle>
            <DialogDescription>
              提交后进入待审核区。请确认资料允许内部复用。
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            标题
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="form-grid">
            <label className="form-label">
              类别
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as Knowledge["category"])
                }
              >
                {categories.slice(1, 5).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              摘要
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
          </div>
          <label className="form-label">
            内容与来源
            <textarea
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={permission}
              onChange={(e) => setPermission(e.target.checked)}
            />
            资料已脱敏，允许内部复用。
          </label>
          <button
            className="btn primary"
            disabled={
              !title.trim() || !summary.trim() || !content.trim() || !permission
            }
            onClick={publish}
          >
            提交审核
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
