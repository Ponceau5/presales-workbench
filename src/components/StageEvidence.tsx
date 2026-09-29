import { Fragment, useState } from "react";
import { Link } from "react-router";
import { configVersions } from "@/lib/configVersions";
import {
  projectResources,
  rackStageResources,
  fileHref,
} from "@/lib/portfolio";
import { PointReader, DocumentReader } from "@/components/SourceReader";

export function StageEvidence({
  id,
  projectId,
}: {
  id: string;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState("BMS");
  if (projectId !== "RCJM1") return null;
  if (id === "F3")
    return (
      <section className="stage-source-panel">
        <h2>点表明细</h2>
        <PointReader />
      </section>
    );
  if (["F4", "F7", "F8"].includes(id)) {
    const version = configVersions[1];
    const rows = (version.sheets.find((s) => s.name === sheet)?.content || "")
      .split("\n")
      .map((line) => line.split(" | "));
    const heading = rows[0];
    const filtered = rows
      .slice(1)
      .filter((row) =>
        row.join(" ").toLowerCase().includes(query.toLowerCase()),
      );
    return (
      <section className="stage-source-panel">
        <div className="stage-source-heading">
          <h2>配置明细</h2>
          <Link to={"/projects/" + projectId + "?view=changes"}>版本对比</Link>
        </div>
        <div className="stage-source-tools">
          <select
            aria-label="配置工作表"
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
          >
            {version.sheets.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          <input
            aria-label="查找配置设备"
            placeholder="查找设备、型号或物料号"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>{filtered.length} 行 · 2026-09-06</span>
        </div>
        <div className="stage-source-scroll">
          <table className="stage-source-table config-source-table">
            <thead>
              <tr>
                {heading.map((h, i) => (
                  <th key={i} title={h}>
                    {h.replace(/[A-Za-z]/g, "").trim() || h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <Fragment key={i}>
                  <tr>
                    {heading.map((_, j) => (
                      <td key={j}>
                        {j === 1 ? (
                          <button
                            className="config-cell"
                            title={row[j]}
                            aria-expanded={expanded === i}
                            onClick={() =>
                              setExpanded(expanded === i ? null : i)
                            }
                          >
                            {row[j] || "—"}
                          </button>
                        ) : (
                          <span className="config-cell" title={row[j]}>
                            {row[j] || "—"}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                  {expanded === i && (
                    <tr>
                      <td colSpan={heading.length}>
                        <dl className="config-row-detail">
                          {heading.map((h, j) => (
                            <div key={j}>
                              <dt>{h}</dt>
                              <dd>{row[j] || "—"}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <small className="stage-source-caption">
          {version.file} · 技术字段
        </small>
      </section>
    );
  }
  if (id === "F2")
    return (
      <section className="stage-source-panel">
        <h2>规格书原文</h2>
        <DocumentReader document="bms-spec" />
      </section>
    );
  const sources = projectResources.filter((r) =>
    (rackStageResources[id] || []).includes(r.id),
  );
  return (
    <section className="stage-source-panel">
      <div className="stage-source-heading">
        <h2>关联资料</h2>
        <Link to={"/projects/" + projectId + "?view=materials"}>全部资料</Link>
      </div>
      <table className="stage-source-table stage-linked-sources">
        <thead>
          <tr>
            <th>资料</th>
            <th>版本</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={fileHref(r.path)}>{r.title}</a>
              </td>
              <td>{r.version}</td>
              <td>{r.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
