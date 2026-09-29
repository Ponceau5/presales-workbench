import { ChangeAISummary } from "@/components/ChangeAISummary";
import { configVersions } from "@/lib/configVersions";
import { useProjectChanges, type LogEntry } from "@/lib/projectChanges";
import { FullTextDiff } from "@/components/FullTextDiff";
import { useState } from "react";
import { Link } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function ChangeLog({
  projectId,
  stage,
  compact = false,
}: {
  projectId: string;
  stage?: string;
  compact?: boolean;
}) {
  const entries = useProjectChanges(projectId);
  const [opened, setOpened] = useState<LogEntry | null>(null);
  const [sheet, setSheet] = useState("BMS");
  const configuration = opened?.id.startsWith("RC-N0906");
  const [onlyStage, setOnlyStage] = useState(false);

  const visible = entries.filter(
    (e) => !onlyStage || !stage || e.affected.includes(stage),
  );
  return (
    <section className={"project-change-log " + (compact ? "compact-log" : "")}>
      <header>
        <h2>
          项目变更日志 <span>{entries.length}</span>{" "}
        </h2>
        <div>
          {stage && (
            <button onClick={() => setOnlyStage(!onlyStage)}>
              {onlyStage ? "全部变更" : "只看 " + stage + " 相关"}
            </button>
          )}
          <Link to={"/projects/" + projectId + "?view=flow"}>
            查看影响环节 →
          </Link>
        </div>
      </header>
      {visible.length ? (
        <div className="change-ledger">
          {visible.map((e) => (
            <button key={e.id} onClick={() => setOpened(e)}>
              <span>
                <strong>{e.title}</strong>
                <small>{e.documentTitle || e.source}</small>
              </span>
              <span>{e.owner}</span>
              <span>{e.status}</span>
              <b>{e.version} ↗</b>
            </button>
          ))}
        </div>
      ) : (
        <p className="ledger-empty">暂无项目变更</p>
      )}
      <Dialog
        open={!!opened}
        onOpenChange={(v) => {
          if (!v) setOpened(null);
        }}
      >
        <DialogContent className="version-diff-dialog">
          <DialogHeader>
            <DialogTitle>{opened?.title}</DialogTitle>
            <DialogDescription>
              {opened?.version} · {opened?.owner} · {opened?.status}
            </DialogDescription>
          </DialogHeader>
          <div className="diff-document-label">
            {opened?.documentTitle || opened?.title}
            <span>
              {configuration
                ? "原表全文对比"
                : opened?.documentBefore
                  ? "完整工件快照"
                  : "记录原文"}
            </span>
          </div>
          {configuration && (
            <>
              <div className="version-files">
                <span>{configVersions[0].file}</span>
                <span>{configVersions[1].file}</span>
              </div>
              <div className="diff-sheet-tabs">
                {[
                  ...new Set(
                    configVersions.flatMap((v) => v.sheets.map((s) => s.name)),
                  ),
                ].map((name) => (
                  <button
                    className={sheet === name ? "active" : ""}
                    key={name}
                    onClick={() => setSheet(name)}
                  >
                    {name}
                  </button>
                ))}
                <span>技术字段 · 价格列未导入</span>
              </div>
            </>
          )}
          {opened && (
            <ChangeAISummary
              key={"summary-" + opened.id + sheet}
              entry={opened}
              before={
                configuration
                  ? configVersions[0].sheets.find((s) => s.name === sheet)
                      ?.content || ""
                  : opened.documentBefore || opened.before
              }
              after={
                configuration
                  ? configVersions[1].sheets.find((s) => s.name === sheet)
                      ?.content || ""
                  : opened.documentAfter || opened.after
              }
            />
          )}
          <FullTextDiff
            key={"diff-" + (opened?.id || "") + sheet}
            before={
              configuration
                ? configVersions[0].sheets.find((s) => s.name === sheet)
                    ?.content || ""
                : opened?.documentBefore || opened?.before || ""
            }
            after={
              configuration
                ? configVersions[1].sheets.find((s) => s.name === sheet)
                    ?.content || ""
                : opened?.documentAfter || opened?.after || ""
            }
          />

          <div className="diff-impact">
            <strong>受影响环节</strong>
            <span>
              {opened?.affected.map((id) => (
                <Link
                  key={id}
                  className="impact-stage-link"
                  to={"/projects/" + projectId + "?view=flow&stage=" + id}
                  onClick={() => setOpened(null)}
                >
                  {id}
                </Link>
              ))}
            </span>
            <small>依据：{opened?.source}</small>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
