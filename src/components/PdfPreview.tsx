import { useState } from "react";
export function PdfPreview({ path, pages }: { path: string; pages: number }) {
  const [page, setPage] = useState(1);
  const name = path.split("/").at(-1)!.replace(".pdf", "");
  const image =
    path.slice(0, path.lastIndexOf("/")) +
    "/previews/" +
    name +
    "-" +
    String(page).padStart(String(pages).length, "0") +
    ".jpg";
  return (
    <section className="pdf-preview">
      <div className="source-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <select
          aria-label="公共资料页码"
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
        >
          {Array.from({ length: pages }, (_, i) => (
            <option key={i} value={i + 1}>
              第 {i + 1} 页 / {pages}
            </option>
          ))}
        </select>
        <button disabled={page === pages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
        <a href={path} target="_blank" rel="noreferrer">
          打开 PDF ↗
        </a>
      </div>
      <div className="pdf-page-image">
        <img src={image} alt={"资料原文第 " + page + " 页"} />
      </div>
    </section>
  );
}
