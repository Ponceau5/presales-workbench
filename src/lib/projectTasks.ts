import { readProjectReview } from "./projectReview";
import { referenceItems } from "./referenceReview";
import { demoReviewItems } from "./demoReview";
import { stageRowOwner } from "./accounts";
import { stagesForProject } from "./projectStages";
import { stageFlow } from "./workflowEngine";
import type { State } from "@/state/workbench";
export interface ProjectTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  stage: string;
  status: string;
  url: string;
  priority: boolean;
  owner?: string;
}
export function projectTasks(state: State): ProjectTask[] {
  const result: ProjectTask[] = [];
  for (const p of state.projects) {
    const items = p.reference ? referenceItems : demoReviewItems;
    const review = readProjectReview(p.id, state);
    for (const i of items.filter((i) => i.owner === state.role)) {
      const r = review.rows[i.id];
      if (r?.written) continue;
      result.push({
        id: p.id + i.id,
        title: i.title,
        owner: i.owner,
        projectId: p.id,
        projectName: p.name.replace(" · RCJM1", ""),
        stage: "F5",
        status:
          r?.status === "rejected"
            ? "已驳回"
            : r?.status === "approved"
              ? "待写回"
              : i.blocker && !r?.resolution
                ? "待确认"
                : "待复核",
        url: "/projects/" + p.id + "?view=review&stage=F5&item=" + i.id,
        priority: !!i.blocker,
      });
    }
    if (
      state.role === "PM / PO" &&
      items.some((i) => !review.rows[i.id]?.written)
    )
      result.push({
        id: p.id + "F5-coordination",
        title: "软件专业协作",
        owner: "软件产品 / 研发 / 解决方案",
        projectId: p.id,
        projectName: p.name,
        stage: "F5",
        status: "待协调",
        url: "/projects/" + p.id + "?view=flow&stage=F5",
        priority: true,
      });
    const snap = p.id === state.currentProjectId ? state : p.snapshot;
    for (const def of stagesForProject(p.id)) {
      const data = snap?.stageStates[def.id] || {
        generated: false,
        written: false,
        rows: def.outputs.map((r) => ({ ...r, status: "waiting" as const })),
        change: false,
        response: undefined,
      };
      if (data.written) continue;
      const flow = stageFlow(data, state.deliveries, p.id, def.id);
      if (state.role === "PM / PO") {
        result.push({
          id: p.id + def.id + "-coordination",
          title: def.title,
          owner: def.owner,
          projectId: p.id,
          projectName: p.name,
          stage: def.id,
          status: flow.status === "blocked" ? "待处理失效" : "待协调",
          url: "/projects/" + p.id + "?view=flow&stage=" + def.id,
          priority: !!data.change,
        });
        continue;
      }

      for (const [n, row] of data.rows.entries()) {
        if (stageRowOwner(def.id, n) !== state.role) continue;
        result.push({
          id: p.id + def.id + n,
          title: row.title,
          owner: stageRowOwner(def.id, n),
          projectId: p.id,
          projectName: p.name,
          stage: def.id,
          status: flow.status === "blocked" && flow.reason === "已接收的上游版本失效"
            ? "版本失效"
            : !data.generated
            ? "待开始"
            : row.status === "approved"
              ? data.rows.every((r) => r.status === "approved") && data.response
                ? "待写回"
                : "待交接"
              : row.status === "rejected"
                ? "已驳回"
                : "待复核",
          url:
            "/projects/" + p.id + "?view=review&stage=" + def.id + "&row=" + n,
          priority: !!data.change,
        });
      }
    }
  }
  for (const f of state.followups.filter(
    (f) => f.owner === state.role && f.status !== "done",
  ))
    result.unshift({
      id: f.id,
      title: f.title,
      owner: f.owner,
      projectId: f.projectId,
      projectName:
        state.projects.find((p) => p.id === f.projectId)?.name || f.projectId,
      stage: "跟进",
      status: "待跟进",
      url: f.url || "/projects/" + f.projectId + "?view=attention",
      priority: true,
    });
  for (const f of state.followups.filter(
    (f) =>
      f.createdBy === state.accountId && f.status === "done" && !f.acceptedAt,
  ))
    result.unshift({
      id: f.id,
      title: f.title,
      owner: f.owner,
      projectId: f.projectId,
      projectName:
        state.projects.find((p) => p.id === f.projectId)?.name || f.projectId,
      stage: "答复",
      status: "待处理答复",
      url: f.url || "/projects/" + f.projectId + "?view=attention",
      priority: true,
    });
  for (const d of (state.deliveries || []).filter(
    (d) =>
      d.owner === state.role &&
      ((d.status === "pending" && !d.outdated) ||
        (d.status === "accepted" && d.outdated)),
  ))
    result.unshift({
      id: d.id,
      title: d.title,
      owner: d.senderRole + " → " + d.owner,
      projectId: d.projectId,
      projectName:
        state.projects.find((p) => p.id === d.projectId)?.name || d.projectId,
      stage: "交接",
      status: d.outdated ? "版本失效" : "待接收",
      url: `/projects/${d.projectId}?view=collaboration`,
      priority: true,
    });
  return result;
}
