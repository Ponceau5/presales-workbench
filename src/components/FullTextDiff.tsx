import { useMemo, useState } from "react";
import { textDiff } from "@/lib/textDiff";
import { alignLines } from "@/lib/lineDiff";
export function FullTextDiff({
  before,
  after,
  leftLabel = "变更前",
  rightLabel = "变更后",
}: {
  before: string;
  after: string;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const rows = useMemo(() => alignLines(before, after), [before, after]);
  const [only, setOnly] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <div className="full-diff">
      <div className="full-diff-tools">
        <span>
          {rows.filter((r) => r.changed).length} 处行变化 ·{" "}
          {before.split("\n").length} / {after.split("\n").length} 行
        </span>
        <input
          aria-label="搜索对比内容"
          placeholder="搜索全文"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={only}
            onChange={(e) => setOnly(e.target.checked)}
          />
          只看变化
        </label>
      </div>
      <div className="full-diff-scroll">
        <table>
          <colgroup>
            <col style={{ width: 36 }} />
            <col />
            <col style={{ width: 36 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={2}>{leftLabel}</th>
              <th colSpan={2}>{rightLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (r) =>
                  (!only || r.changed) &&
                  (!query ||
                    `${r.left || ""}${r.right || ""}`
                      .toLowerCase()
                      .includes(query.toLowerCase())),
              )
              .map((r, i) => {
                const d = textDiff(r.left || "", r.right || "");
                return (
                  <tr key={i} className={r.changed ? "changed-line" : ""}>
                    <td className="line-number">{r.ln}</td>
                    <td
                      className={
                        r.changed && r.left !== undefined ? "line-removed" : ""
                      }
                    >
                      {d.before.map((p, k) =>
                        p.changed ? (
                          <mark key={k} className="removed">
                            {p.text}
                          </mark>
                        ) : (
                          <span key={k}>{p.text}</span>
                        ),
                      )}
                    </td>
                    <td className="line-number">{r.rn}</td>
                    <td
                      className={
                        r.changed && r.right !== undefined ? "line-added" : ""
                      }
                    >
                      {d.after.map((p, k) =>
                        p.changed ? (
                          <mark key={k} className="added">
                            {p.text}
                          </mark>
                        ) : (
                          <span key={k}>{p.text}</span>
                        ),
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
