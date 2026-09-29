import { referenceChanges } from "@/lib/referenceChanges";
import { sampleChanges } from "@/lib/sampleChanges";
import { changes } from "@/lib/presales";
import { useWorkbench } from "@/state/workbench";
import { stagesForProject } from "@/lib/projectStages";
import { referenceItems } from "@/lib/referenceReview";
import { demoReviewItems } from "@/lib/demoReview";
import { readProjectReview } from "@/lib/projectReview";
import type { State } from "@/state/workbench";
export interface LogEntry {
  id: string;
  title: string;
  before: string;
  after: string;
  version: string;
  owner: string;
  affected: string[];
  source: string;
  status: string;
  documentTitle?: string;
  documentBefore?: string;
  documentAfter?: string;
}
export function useProjectChanges(projectId: string): LogEntry[] {
  const { state } = useWorkbench();
  return projectChanges(state, projectId);
}
export function projectChanges(state: State, projectId: string): LogEntry[] {
  const stages = stagesForProject(projectId);
  const review = readProjectReview(projectId, state);
  const items = projectId === "RCJM1" ? referenceItems : demoReviewItems;
  const snapshot = (projectId === state.currentProjectId
    ? state
    : state.projects.find((p) => p.id === projectId)?.snapshot) || {
    audit: [],
    stageStates: {} as State["stageStates"],
    sourceVersion: 6,
    changeStatus: {} as State["changeStatus"],
  };
  return [
    ...state.activity
      .filter(
        (a) =>
          a.projectId === projectId &&
          ["edit", "respond", "regenerate"].includes(a.action) &&
          items.some((i) => i.id === a.target) &&
          (() => {
            try {
              const before = JSON.parse(a.before),
                after = JSON.parse(a.after);
              return (
                before.text !== after.text ||
                before.resolution !== after.resolution
              );
            } catch {
              return a.before !== a.after;
            }
          })(),
      )
      .map((a) => {
        const item = items.find((i) => i.id === a.target)!;
        let before = a.before,
          after = a.after,
          version = "修订";
        try {
          const previous = JSON.parse(before),
            next = JSON.parse(after);
          before = previous.text;
          after = next.text;
          version = "R" + previous.revision + " → R" + next.revision;
        } catch {
          /* stored text */
        }
        const historicalRows = { ...review.rows };
        for (const newer of state.activity.slice(
          0,
          state.activity.findIndex((entry) => entry.id === a.id),
        )) {
          if (
            newer.projectId !== projectId ||
            !items.some((i) => i.id === newer.target)
          )
            continue;
          try {
            historicalRows[newer.target] = JSON.parse(newer.before);
          } catch {
            /* Plain legacy events retain current row. */
          }
        }
        const beforeRows = { ...historicalRows };
        try {
          beforeRows[item.id] = JSON.parse(a.before);
          historicalRows[item.id] = JSON.parse(a.after);
        } catch {
          /* Legacy records carry text only. */
        }
        const renderDocument = (
          rows: typeof review.rows,
          changedText: string,
        ) =>
          items
            .filter((i) => i.category === item.category)
            .map((i) =>
              [
                i.id + "  " + i.title,
                "要求：" + i.requirement,
                "应答：" +
                  (i.id === item.id
                    ? changedText
                    : rows[i.id]?.text || i.draft),
                "确认：" + (rows[i.id]?.resolution || "未登记"),
                "依据：" + (rows[i.id]?.evidence || i.source),
              ].join("\n"),
            )
            .join("\n\n");
        return {
          id: a.id,
          title: item.title,
          documentTitle: item.category + " · 完整工件",
          documentBefore: renderDocument(beforeRows, before),
          documentAfter: renderDocument(historicalRows, after),
          before,
          after,
          version,
          owner: a.accountId + " · " + a.role,
          affected: ["F5", "F7", "F10"],
          source: item.source,
          status: review.rows[item.id]?.written ? "已写回" : "待复核",
        };
      }),
    ...snapshot.audit
      .filter((a) => a.action === "change" && /^F\d+$/.test(a.target))
      .map((a) => {
        const def = stages.find((d) => d.id === a.target)!;
        let before = def.outputs[0].text,
          after = def.changedText;
        try {
          before = JSON.parse(a.before).rows[0].text;
          after = JSON.parse(a.after).rows[0].text;
        } catch {
          /* Preserve known source text. */
        }
        return {
          id: a.id,
          title: def.change,
          documentTitle: def.title + " · 成果工件",
          documentBefore: def.outputs
            .map((o, i) => o.title + "\n" + (i === 0 ? before : o.text))
            .join("\n\n"),
          documentAfter: def.outputs
            .map((o, i) => o.title + "\n" + (i === 0 ? after : o.text))
            .join("\n\n"),
          before,
          after,
          version: "V" + (a.version - 1) + " → V" + a.version,
          owner: a.actor,
          affected: [a.target, ...def.next.filter((x) => x !== "F14")],
          source:
            def.source +
            " · " +
            new Date(a.at).toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          status: snapshot.stageStates[a.target]?.written ? "已写回" : "待复核",
        };
      }),
    ...(projectId === "RCJM1"
      ? referenceChanges
      : sampleChanges[projectId] || []),
    ...(projectId !== "RCJM1" && snapshot.sourceVersion === 7
      ? changes.map((c) => ({
          id: c.id,
          title: c.title,
          before: c.before,
          after: c.after,
          version: "V6 → V7",
          owner: c.owner,
          affected: ["F2", "F5", "F7", "F10"],
          source: c.section,
          status: snapshot.changeStatus[c.id] === "done" ? "已完成" : "待复核",
        }))
      : []),
  ];
}
