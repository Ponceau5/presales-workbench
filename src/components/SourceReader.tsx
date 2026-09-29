import { useProjectSource } from "@/lib/sourceData";
import { useState } from "react";
import { ExternalLink, Search, ChevronDown } from "lucide-react";

export interface PointRow {
  row: number;
  equipment: string;
  quantity: number;
  perUnit: number;
  points: number;
  quantityCell: string;
  cells: { cell: string; label: string; value: string | number }[];
  unresolved: string[];
}
export interface PointBook {
  file: string;
  version: string;
  sheets: { name: string; total: number; rows: PointRow[] }[];
  dcim: {
    row: number;
    name: string;
    description: string;
    unit: string;
    frequency: string;
    provision: string;
  }[];
}
const base = "/project-data/rcjm1/";
export function PointReader() {
  const { data, error } = useProjectSource<PointBook>("points.json");
  const [sheet, setSheet] = useState("PLC-Elect");
  const [query, setQuery] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  if (!data)
    return (
      <p className="source-loading" role="status">
        {error || "正在读取点表…"}
      </p>
    );
  const active = data.sheets.find((s) => s.name === sheet);
  const rows =
    active?.rows.filter(
      (r) =>
        r.equipment.toLowerCase().includes(query.toLowerCase()) &&
        (!uncertain || r.unresolved.length),
    ) || [];
  return (
    <div className="point-reader">
      <div className="source-summary">
        <div>
          <span>数值测点</span>
          <strong>
            {data.sheets.reduce((n, s) => n + s.total, 0).toLocaleString()}
          </strong>
        </div>
        {data.sheets.map((s) => (
          <button
            key={s.name}
            className={sheet === s.name ? "active" : ""}
            onClick={() => {
              setSheet(s.name);
              setExpanded(null);
            }}
          >
            <span>{s.name}</span>
            <strong>{s.total.toLocaleString()}</strong>
          </button>
        ))}
      </div>
      <div className="source-toolbar">
        <label className="index-search">
          <Search size={14} />
          <input
            aria-label="查找点表设备"
            placeholder="查找设备"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={sheet === "DCIM" ? "active" : ""}
          onClick={() => setSheet("DCIM")}
        >
          DCIM 高层点表
        </button>
        {active && (
          <label>
            <input
              type="checkbox"
              checked={uncertain}
              onChange={(e) => setUncertain(e.target.checked)}
            />{" "}
            仅看非数值标记
          </label>
        )}
        <a href={base + "bms-point-schedule.xlsx"} download>
          下载原表 <ExternalLink size={12} />
        </a>
      </div>
      {active ? (
        <>
          <div className="point-table-wrap">
            <table className="point-table">
              <thead>
                <tr>
                  <th>原表行</th>
                  <th>设备</th>
                  <th>数量</th>
                  <th>数值点 / 台</th>
                  <th>数值点合计</th>
                  <th>非数值单元格</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <PointTableRow
                    key={r.row}
                    row={r}
                    expanded={expanded === r.row}
                    onClick={() =>
                      setExpanded(expanded === r.row ? null : r.row)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p className="index-empty">没有匹配的设备。</p>}
          <p className="source-footnote">
            {data.file} · {active.name} · 数值点合计 = 数量 ×
            原表数值单元格之和。“/” 等标记未计入，DCIM 高层点表不重复叠加。
          </p>
        </>
      ) : (
        <div className="point-table-wrap">
          <table className="point-table">
            <thead>
              <tr>
                <th>行</th>
                <th>测点</th>
                <th>单位 / 周期</th>
                <th>覆盖要求</th>
              </tr>
            </thead>
            <tbody>
              {data.dcim.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>
                    <strong>{r.name}</strong>
                    <p>{r.description}</p>
                  </td>
                  <td>
                    {r.unit} / {r.frequency}
                  </td>
                  <td>{r.provision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function PointTableRow({
  row: r,
  expanded,
  onClick,
}: {
  row: PointRow;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <tr>
        <td>{r.row}</td>
        <td>
          <button
            className="point-equipment"
            onClick={onClick}
            aria-expanded={expanded}
          >
            <ChevronDown size={13} />
            {r.equipment}
          </button>
        </td>
        <td>{r.quantity.toLocaleString()}</td>
        <td>{r.perUnit}</td>
        <td>
          <strong>{r.points.toLocaleString()}</strong>
        </td>
        <td>
          {r.unresolved.length ? (
            <span className="status-pending">
              {r.unresolved.length} 个待解释
            </span>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}>
            <div className="point-cell-detail">
              <p>
                设备数量：{r.quantityCell} = {r.quantity}；数值测点：
                {r.quantity} × {r.perUnit} = {r.points.toLocaleString()}
              </p>
              {r.cells.map((c) => (
                <span key={c.cell}>
                  <code>{c.cell}</code>
                  <span>{c.label}</span>
                  <b>{String(c.value)}</b>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
export function DocumentReader({
  document,
  initialPage = 1,
  initialParagraph,
  focusTerm,
}: {
  document: "bms-spec" | "control-sequence" | "dcom-requirements";
  initialPage?: number;
  initialParagraph?: number;
  focusTerm?: string;
}) {
  const { data, error } = useProjectSource<{
    pages?: { page: number; text: string }[];
    paragraphs?: { paragraph: number; text: string }[];
  }>(document + ".json");
  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [original, setOriginal] = useState(false);
  const [focused, setFocused] = useState(!!initialParagraph || !!focusTerm);
  if (!data) return <p role="status">{error || "正在读取资料…"}</p>;
  const pages = data.pages || [
    {
      page: 1,
      text:
        data.paragraphs
          ?.filter(
            (p) =>
              !focused ||
              !initialParagraph ||
              Math.abs(p.paragraph - initialParagraph) <= 6,
          )
          .map((p) => "¶" + p.paragraph + "  " + p.text)
          .join("\n\n") || "",
    },
  ];
  const matching = pages.filter(
    (p) => !query || p.text.toLowerCase().includes(query.toLowerCase()),
  );
  const current = pages.find((p) => p.page === page) || pages[0];
  const located = focusTerm
    ? current.text
        .split(/\n\s*\n/)
        .filter((block) =>
          block.toLowerCase().includes(focusTerm.toLowerCase()),
        )
        .join("\n\n")
    : "";
  const visibleText = focused && located ? located : current.text;
  return (
    <div className="document-reader">
      <div className="source-toolbar">
        <label className="index-search">
          <Search size={14} />
          <input
            aria-label="搜索资料正文"
            placeholder="搜索正文"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {focusTerm && (
          <button onClick={() => setFocused(!focused)}>
            {focused ? "查看整页" : "定位要求"}
          </button>
        )}
        {initialParagraph && (
          <button onClick={() => setFocused(!focused)}>
            {focused ? "查看全文" : "定位 ¶" + initialParagraph}
          </button>
        )}
        {data.pages && (
          <>
            <select
              aria-label="选择原文页码"
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {pages.map((p) => (
                <option key={p.page} value={p.page}>
                  第 {p.page} 页
                </option>
              ))}
            </select>
            <button onClick={() => setOriginal(!original)}>
              {original ? "文本" : "PDF 原文"}
            </button>
            <a
              href={base + document + ".pdf#page=" + page}
              target="_blank"
              rel="noreferrer"
            >
              打开 PDF <ExternalLink size={12} />
            </a>
          </>
        )}
      </div>
      {query && (
        <div className="source-search-results">
          {matching.length
            ? matching.map((p) => (
                <button
                  key={p.page}
                  onClick={() => {
                    setPage(p.page);
                    setOriginal(false);
                  }}
                >
                  第 {p.page} 页
                </button>
              ))
            : "未找到匹配内容"}
        </div>
      )}
      {original && data.pages ? (
        <div className="pdf-page-image">
          <img
            src={
              base +
              "previews/" +
              document +
              "-" +
              String(page).padStart(String(pages.length).length, "0") +
              ".jpg"
            }
            alt={"资料原文第 " + page + " 页"}
          />
        </div>
      ) : (
        <pre className="document-text">{visibleText}</pre>
      )}
    </div>
  );
}
