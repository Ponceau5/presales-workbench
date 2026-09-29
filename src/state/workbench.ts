import {
  publishDelivery,
  invalidateDelivery,
  invalidInputs,
  type Delivery,
} from "@/lib/collaboration";
import { canPublishStage, canReceiveInput } from "@/lib/workflowEngine";
import { demoReviewItems } from "@/lib/demoReview";
import { referenceItems } from "@/lib/referenceReview";
import {
  accounts,
  authenticate,
  stagePermission,
  canEditStageRow,
  canReviewStage,
  canCreateProject,
  canManageConnection,
  canPublishSoftware,
} from "@/lib/accounts";
import {
  rackProject,
  projectResources,
  type ProjectResource,
} from "@/lib/portfolio";
import { knowledge, type Knowledge, type Role } from "@/lib/workspace";
import { stagesForProject } from "@/lib/projectStages";
import { stages } from "@/lib/stages";
import { createContext, useContext } from "react";
import {
  initialRows,
  changes,
  type Row,
  type LLMSettings,
} from "@/lib/presales";
export type ReviewStatus = "waiting" | "approved" | "rejected";
export interface ReviewedRow extends Row {
  status: ReviewStatus;
  version: number;
  revision: number;
  note: string;
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  version: number;
  before: string;
  after: string;
  note: string;
  previousStatus?: string;
  nextStatus?: string;
}
export interface Clarification {
  text: string;
  evidence: string;
}
export interface StageState {
  generated: boolean;
  version: number;
  rows: {
    title: string;
    text: string;
    evidence: string;
    status: ReviewStatus;
  }[];
  response?: Clarification;
  written: boolean;
  change: boolean;
  assigned: boolean;
}
export interface Project {
  id: string;
  name: string;
  owner: string;
  updated: string;
  reference?: boolean;
  snapshot?: ProjectSnapshot;
}
export type ProjectSnapshot = Pick<
  State,
  | "stageStates"
  | "rows"
  | "generated"
  | "run"
  | "sourceVersion"
  | "events"
  | "clarified"
  | "modelConfirmed"
  | "audit"
  | "facts"
  | "changeStatus"
>;
export interface State {
  deliveries: Delivery[];
  accountId: string | null;
  activity: {
    id: string;
    at: string;
    accountId: string;
    role: Role;
    projectId: string;
    target: string;
    action: string;
    before: string;
    after: string;
  }[];
  permissionNotice: string;

  role: Role;
  bookmarks: Partial<Record<Role, string[]>>;
  theme: "light" | "dark";
  knowledge: Knowledge[];
  resources: ProjectResource[];
  followups: {
    id: string;
    projectId: string;
    title: string;
    owner: string;
    source: string;
    url?: string;
    status?: "open" | "done";
    result?: string;
    completedAt?: string;
    createdBy?: string;
    createdRole?: Role;
    acceptedAt?: string;
  }[];
  projects: Project[];
  currentProjectId: string;
  stageStates: Record<string, StageState>;
  rows: ReviewedRow[];
  generated: boolean;
  run: number;
  sourceVersion: number;
  events: string[];
  running: boolean;
  clarified: Record<string, Clarification>;
  modelConfirmed: boolean;
  audit: Audit[];
  facts: ReviewedRow[];
  changeStatus: Record<string, "pending" | "assigned" | "reviewing" | "done">;
  settings: LLMSettings;
}
export const initialState = (settings: LLMSettings): State => ({
  deliveries: [],
  accountId: null,
  activity: [],
  permissionNotice: "",
  role: "软件产品",
  bookmarks: {},
  theme: "light",
  knowledge: knowledge.map((k) => ({ ...k })),
  resources: projectResources.map((r) => ({ ...r })),
  followups: [],
  projects: [
    rackProject,
    {
      id: "DEMO-026",
      name: "数据中心二期",
      owner: "软件产品",
      updated: "09.28",
    },
  ],
  currentProjectId: "DEMO-026",
  stageStates: Object.fromEntries(
    stages.map((s) => [
      s.id,
      {
        generated: false,
        version: 1,
        rows: s.outputs.map((r) => ({ ...r, status: "waiting" as const })),
        written: false,
        change: false,
        assigned: false,
      },
    ]),
  ),
  rows: initialRows.map((r) => ({
    ...r,
    status: "waiting",
    version: 6,
    revision: 1,
    note: "",
  })),
  generated: false,
  run: 0,
  sourceVersion: 6,
  events: [],
  running: false,
  clarified: {},
  modelConfirmed: false,
  audit: [],
  facts: [],
  changeStatus: { "D-01": "pending", "D-02": "pending" },
  settings,
});
export type StageAction = {
  type: "stage";
  id: string;
  kind:
    | "generate"
    | "approve"
    | "edit"
    | "reject"
    | "respond"
    | "write"
    | "change"
    | "assign";
  index?: number;
  text?: string;
  evidence?: string;
  actor: string;
  note: string;
};
export type Action =
  | { type: "hydrateShared"; state: State }
  | {
      type: "deliveryReceive";
      id: string;
      projectId: string;
      status: "accepted" | "returned";
      note: string;
    }
  | {
      type: "publishSoftware";
      projectId: string;
      artifactId: string;
      title: string;
      text: string;
      evidence: string;
      version: string;
      category: string;
    }
  | { type: "agentRun"; projectId: string; id: string; summary: string }
  | { type: "login"; username: string; password: string }
  | { type: "followupAccept"; id: string; projectId: string }
  | { type: "followupComplete"; id: string; projectId: string; result: string }
  | {
      type: "referenceAudit";
      projectId?: string;
      id: string;
      action: string;
      before: string;
      after: string;
    }
  | { type: "logout" }
  | { type: "dismissPermission" }
  | { type: "resource"; item: ProjectResource }
  | {
      type: "followup";
      projectId: string;
      title: string;
      owner: string;
      source?: string;
      url?: string;
    }
  | { type: "role"; role: Role }
  | { type: "theme"; theme: "light" | "dark" }
  | { type: "bookmark"; id: string }
  | { type: "knowledge"; item: Knowledge }
  | { type: "knowledgeApprove"; id: string; note: string }
  | { type: "projectCreate"; name: string; owner: string }
  | { type: "projectSwitch"; id: string }
  | StageAction
  | { type: "start"; ids?: string[] }
  | { type: "event"; message: string }
  | { type: "finish"; ids?: string[] }
  | {
      type: "review";
      id: string;
      action: "approve" | "edit" | "reject";
      text?: string;
      note: string;
      actor: string;
    }
  | {
      type: "respond";
      id: string;
      text: string;
      evidence: string;
      actor: string;
    }
  | { type: "model"; actor: string }
  | { type: "write"; actor: string }
  | { type: "change"; id: string; status: "assigned" | "reviewing" }
  | { type: "settings"; settings: LLMSettings }
  | { type: "reset"; settings: LLMSettings };
export function blocked(row: ReviewedRow, s: State) {
  if (row.artifact === "clarification") return false;
  if (row.blocker === "model") return !s.modelConfirmed || !s.clarified["Q-01"];
  if (row.blocker === "video") return !s.clarified["Q-01"];
  if (row.blocker === "kafka") return !s.clarified["Q-02"];
  return false;
}
export const canWrite = (s: State) =>
  s.generated &&
  !s.running &&
  s.rows.every((r) => r.status === "approved" && !blocked(r, s));
export function permitted(s: State, a: Action): boolean {
  if (["login", "logout", "dismissPermission"].includes(a.type)) return true;
  if (!s.accountId) return false;
  if (a.type === "role") return false;
  if (a.type === "deliveryReceive")
    return s.deliveries.some(
      (d) =>
        d.id === a.id &&
        d.projectId === a.projectId &&
        canReceiveInput(d, s.role, a.status, a.note),
    );
  if (a.type === "publishSoftware")
    return (
      (a.projectId === "RCJM1" ? referenceItems : demoReviewItems).some(
        (i) => i.id === a.artifactId && i.owner === s.role,
      ) &&
      a.projectId === s.currentProjectId &&
      !invalidInputs(s, "F5").length
    );
  if (a.type === "followupAccept")
    return s.followups.some(
      (f) =>
        f.id === a.id &&
        f.projectId === a.projectId &&
        f.createdBy === s.accountId &&
        f.status === "done" &&
        !f.acceptedAt,
    );
  if (a.type === "followupComplete") {
    const f = s.followups.find((f) => f.id === a.id);
    return (
      !!f &&
      f.projectId === a.projectId &&
      (f.owner === s.role || s.role === "PM / PO")
    );
  }
  if (a.type === "agentRun")
    return s.projects.some((p) => p.id === a.projectId);
  if (a.type === "referenceAudit")
    return (
      (a.projectId && a.projectId !== "RCJM1"
        ? demoReviewItems
        : referenceItems
      ).find((i) => i.id === a.id)?.owner === s.role
    );
  if (a.type === "stage" && ["approve", "edit", "reject"].includes(a.kind))
    return canEditStageRow(s.role, a.id, a.index || 0);
  if (a.type === "stage")
    return a.kind === "assign"
      ? s.role === "PM / PO" || stagePermission(s.role, a.id)
      : ["approve", "reject", "write"].includes(a.kind)
        ? canReviewStage(s.role, a.id)
        : stagePermission(s.role, a.id);
  if (a.type === "review" || a.type === "respond")
    return s.rows.find((r) => r.id === a.id)?.owner === s.role;
  if (a.type === "model") return s.role === "解决方案";
  if (a.type === "write") return canPublishSoftware(s.role);
  if (a.type === "start" || a.type === "finish" || a.type === "event") {
    if (!["软件产品", "研发", "解决方案"].includes(s.role)) return false;
    if ("ids" in a && a.ids)
      return a.ids.every(
        (id) => s.rows.find((r) => r.id === id)?.owner === s.role,
      );
    return true;
  }
  if (a.type === "change")
    return s.role === "PM / PO" || s.role === "软件产品" || s.role === "研发";
  if (a.type === "settings") return canManageConnection(s.role);
  if (a.type === "reset") return s.role === "PM / PO";
  if (a.type === "projectCreate") return canCreateProject(s.role);
  if (a.type === "knowledgeApprove") return s.role === "PM / PO";
  return true;
}
export function reducer(s: State, a: Action): State {
  if (a.type === "hydrateShared") return a.state;
  if (a.type === "dismissPermission") return { ...s, permissionNotice: "" };
  if (a.type === "login") {
    const account = authenticate(a.username, a.password);
    if (!account) return { ...s, permissionNotice: "账号或密码不正确" };
    return {
      ...s,
      accountId: account.id,
      role: account.role,
      permissionNotice: "",
    };
  }
  if (a.type === "logout")
    return s.running
      ? s
      : {
          ...s,
          accountId: null,
          settings: { ...s.settings, apiKey: "", allowBrowserKey: false },
          permissionNotice: "",
        };
  if (!permitted(s, a))
    return { ...s, permissionNotice: "当前账号无权执行此操作" };
  const actor = accounts.find((x) => x.id === s.accountId)!;
  const next =
    a.type === "referenceAudit" || a.type === "agentRun"
      ? {
          ...s,
          deliveries:
            a.type === "referenceAudit" && a.action !== "write"
              ? (() => {
                  const items =
                    a.projectId === "RCJM1" ? referenceItems : demoReviewItems;
                  const impacted = new Set([a.id]);
                  if (a.action === "extract" || a.action === "verify")
                    for (const id of items.find((i) => i.id === a.id)
                      ?.dependsOn || [])
                      impacted.add(id);
                  let changed = true;
                  while (changed) {
                    changed = false;
                    for (const i of items)
                      if (
                        !impacted.has(i.id) &&
                        i.dependsOn?.some((id) => impacted.has(id))
                      ) {
                        impacted.add(i.id);
                        changed = true;
                      }
                  }
                  return [...impacted].reduce(
                    (current, id) => ({
                      ...current,
                      deliveries: invalidateDelivery(current, id),
                    }),
                    s,
                  ).deliveries;
                })()
              : s.deliveries,
        }
      : domainReducer(
          s,
          "actor" in a ? { ...a, actor: actor.id + " · " + actor.role } : a,
        );
  if (
    next === s ||
    ["theme", "bookmark", "projectSwitch", "event", "start", "finish"].includes(
      a.type,
    )
  )
    return next;
  const target =
    a.type === "deliveryReceive"
      ? s.deliveries.find((d) => d.id === a.id)?.title || a.id
      : a.type === "publishSoftware"
        ? a.title
        : a.type === "followupComplete" || a.type === "followupAccept"
          ? s.followups.find((f) => f.id === a.id)?.title || a.id
          : a.type === "followup"
            ? a.title
            : "id" in a
              ? a.id
              : a.type === "resource"
                ? a.item.id
                : a.type === "knowledge"
                  ? a.item.id
                  : s.currentProjectId;
  const latest = next.audit.length > s.audit.length ? next.audit[0] : undefined;
  const before =
    (a.type === "deliveryReceive"
      ? JSON.stringify(s.deliveries.find((d) => d.id === a.id))
      : "") ||
    (a.type === "referenceAudit" ? a.before : latest?.before) ||
    (a.type === "stage"
      ? JSON.stringify(s.stageStates[a.id])
      : a.type === "followupComplete" || a.type === "followupAccept"
        ? JSON.stringify(s.followups.find((f) => f.id === a.id))
        : "");
  const after =
    (a.type === "deliveryReceive"
      ? JSON.stringify(next.deliveries.find((d) => d.id === a.id))
      : a.type === "publishSoftware"
        ? JSON.stringify(
            next.deliveries.filter(
              (d) =>
                d.artifactId === a.artifactId &&
                d.projectId === a.projectId &&
                !d.outdated,
            ),
          )
        : "") ||
    (a.type === "agentRun"
      ? a.summary
      : a.type === "referenceAudit"
        ? a.after
        : latest?.after) ||
    (a.type === "followupComplete" || a.type === "followupAccept"
      ? JSON.stringify(next.followups.find((f) => f.id === a.id))
      : a.type === "stage"
        ? JSON.stringify(next.stageStates[a.id])
        : a.type === "settings"
          ? "连接配置已更新（不记录密钥）"
          : a.type === "followup"
            ? JSON.stringify(next.followups[0])
            : a.type === "resource" || a.type === "knowledge"
              ? JSON.stringify(a.item)
              : "");
  return {
    ...next,
    permissionNotice: "",
    activity: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        accountId: actor.id,
        role: actor.role,
        projectId:
          a.type === "referenceAudit"
            ? a.projectId || "RCJM1"
            : "projectId" in a
              ? a.projectId
              : s.currentProjectId,
        target,
        action:
          a.type === "stage"
            ? a.kind
            : a.type === "review" || a.type === "referenceAudit"
              ? a.action
              : a.type,
        before,
        after,
      },
      ...s.activity,
    ],
  };
}
export function domainReducer(s: State, a: Action): State {
  const log = (
    action: string,
    target: string,
    before: string,
    after: string,
    note: string,
    actor: string,
  ): Audit => ({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor,
    action,
    target,
    version: s.sourceVersion,
    before,
    after,
    note,
  });
  if (a.type === "deliveryReceive") {
    if (!a.note.trim()) return s;
    const item = s.deliveries.find((d) => d.id === a.id)!;
    return {
      ...s,
      deliveries: s.deliveries.map((d) =>
        d.id === a.id
          ? {
              ...d,
              status: a.status,
              note: a.note,
              receivedBy: s.accountId!,
              receivedAt: new Date().toISOString(),
            }
          : a.status === "accepted" &&
              d.projectId === item.projectId &&
              d.artifactId === item.artifactId &&
              d.toStage === item.toStage &&
              d.owner === item.owner &&
              d.outdated &&
              d.status === "accepted"
            ? { ...d, status: "returned", note: "已接收替代版本" }
            : d,
      ),
    };
  }
  if (a.type === "publishSoftware") {
    const targets =
      a.category === "研发路径"
        ? ["F5", "F7"]
        : a.category === "服务器"
          ? ["F4", "F7"]
          : a.category === "澄清"
            ? ["F2"]
            : ["F7", "F10"];
    return {
      ...s,
      deliveries: publishDelivery(
        s,
        {
          artifactId: a.artifactId,
          title: a.title,
          text: a.text,
          evidence: a.evidence,
          version: a.version,
          fromStage: "F5",
        },
        targets,
      ),
    };
  }
  if (a.type === "role") return { ...s, role: a.role };
  if (a.type === "theme") return { ...s, theme: a.theme };
  if (a.type === "bookmark") {
    const ids = s.bookmarks[s.role] || [];
    return {
      ...s,
      bookmarks: {
        ...s.bookmarks,
        [s.role]: ids.includes(a.id)
          ? ids.filter((id) => id !== a.id)
          : [...ids, a.id],
      },
    };
  }
  if (a.type === "knowledge")
    return {
      ...s,
      knowledge: [{ ...a.item, status: "pending" }, ...s.knowledge],
    };
  if (a.type === "knowledgeApprove") {
    if (s.role !== "PM / PO" || !a.note.trim()) return s;
    return {
      ...s,
      knowledge: s.knowledge.map((k) =>
        k.id === a.id
          ? {
              ...k,
              status: "approved",
              approvedBy: s.role,
              approvedAt: new Date().toISOString(),
              reviewNote: a.note,
            }
          : k,
      ),
    };
  }
  if (a.type === "projectCreate") {
    if (!a.name.trim() || s.running) return s;
    return {
      ...s,
      projects: [
        ...s.projects,
        {
          id: "DEMO-" + crypto.randomUUID().slice(0, 6).toUpperCase(),
          name: a.name.trim(),
          owner: a.owner,
          updated: "刚刚",
        },
      ],
    };
  }
  if (a.type === "resource")
    return { ...s, resources: [a.item, ...s.resources] };
  if (a.type === "followupAccept")
    return {
      ...s,
      followups: s.followups.map((f) =>
        f.id === a.id ? { ...f, acceptedAt: new Date().toISOString() } : f,
      ),
    };
  if (a.type === "followupComplete")
    return !a.result.trim()
      ? s
      : {
          ...s,
          followups: s.followups.map((f) =>
            f.id === a.id
              ? {
                  ...f,
                  status: "done",
                  result: a.result.trim(),
                  completedAt: new Date().toISOString(),
                }
              : f,
          ),
        };
  if (a.type === "followup")
    return {
      ...s,
      followups: [
        {
          id: crypto.randomUUID(),
          projectId: a.projectId,
          title: a.title,
          owner: a.owner,
          source: a.source || "项目跟进",
          url: a.url,
          createdBy: s.accountId || undefined,
          createdRole: s.role,
        },
        ...s.followups,
      ],
    };
  if (a.type === "projectSwitch") {
    if (
      s.running ||
      a.id === s.currentProjectId ||
      !s.projects.some((p) => p.id === a.id)
    )
      return s;
    const {
      stageStates,
      rows,
      generated,
      run,
      sourceVersion,
      events,
      clarified,
      modelConfirmed,
      audit,
      facts,
      changeStatus,
    } = s;
    const snapshot = {
      stageStates,
      rows,
      generated,
      run,
      sourceVersion,
      events,
      clarified,
      modelConfirmed,
      audit,
      facts,
      changeStatus,
    };
    const target = s.projects.find((p) => p.id === a.id)!;
    const next = target.snapshot || initialState(s.settings);
    if (!target.snapshot && target.reference)
      next.stageStates = Object.fromEntries(
        stagesForProject(target.id).map((d) => [
          d.id,
          {
            ...next.stageStates[d.id],
            rows: d.outputs.map((r) => ({ ...r, status: "waiting" as const })),
          },
        ]),
      );
    return {
      ...s,
      ...Object.fromEntries(
        Object.keys(snapshot).map((key) => [
          key,
          next[key as keyof ProjectSnapshot],
        ]),
      ),
      currentProjectId: a.id,
      projects: s.projects.map((p) =>
        p.id === s.currentProjectId ? { ...p, snapshot } : p,
      ),
    };
  }
  if (a.type === "stage") {
    const stage = s.stageStates[a.id];
    const def = stagesForProject(s.currentProjectId).find((d) => d.id === a.id);
    if (!stage || !def || !a.actor.trim()) return s;
    if (a.kind === "write" && invalidInputs(s, a.id).length) return s;
    const next = { ...stage, rows: stage.rows.map((r) => ({ ...r })) };
    const index = a.index ?? 0;
    if (a.kind === "generate") {
      next.generated = true;
      next.rows = next.rows.map((r) =>
        r.status === "approved"
          ? r
          : {
              ...r,
              text:
                r.status === "rejected"
                  ? `${r.text}\n重新生成复核关注：请依据最近驳回记录复核，缺项保持待确认。`
                  : r.text,
              status: "waiting",
            },
      );
      next.written = false;
    }
    if (["approve", "edit", "reject"].includes(a.kind)) {
      if (!stage.generated || !a.note.trim() || !next.rows[index]) return s;
      next.rows[index].status =
        a.kind === "approve"
          ? "approved"
          : a.kind === "reject"
            ? "rejected"
            : "waiting";
      if (a.kind === "edit") {
        if (!a.text?.trim()) return s;
        next.rows[index].text = a.text.trim();
        next.version = stage.version + 1;
      }
      next.written = false;
    }
    if (a.kind === "respond") {
      if (!a.text?.trim() || !a.evidence?.trim() || !stage.generated) return s;
      next.response = { text: a.text, evidence: a.evidence };
      next.version = stage.version + 1;
      next.rows = next.rows.map((r) => ({ ...r, status: "waiting" }));
      next.written = false;
    }
    if (a.kind === "write") {
      if (
        !canPublishStage(
          stage,
          s.deliveries,
          s.currentProjectId,
          a.id,
        )
      )
        return s;
      next.written = true;
    }
    if (a.kind === "change") {
      if (!stage.generated || stage.change) return s;
      next.version = 2;
      next.change = true;
      next.rows[0] = {
        ...next.rows[0],
        text: def.changedText,
        status: "waiting",
      };
      next.response = undefined;
      next.written = false;
      next.assigned = false;
    }
    if (a.kind === "assign") next.assigned = true;
    const before =
      a.kind === "edit" || a.kind === "approve" || a.kind === "reject"
        ? stage.rows[index].text
        : JSON.stringify(stage);
    const after =
      a.kind === "edit" || a.kind === "approve" || a.kind === "reject"
        ? next.rows[index].text
        : JSON.stringify(next);
    return {
      ...s,
      stageStates: { ...s.stageStates, [a.id]: next },
      deliveries:
        a.kind === "write"
          ? next.rows.reduce(
              (deliveries, r, n) =>
                publishDelivery(
                  { ...s, deliveries },
                  {
                    artifactId: a.id + ":" + n,
                    title: r.title,
                    fromStage: a.id,
                    text: r.text + "\n\n确认记录：" + next.response!.text,
                    evidence:
                      r.evidence + "；确认依据：" + next.response!.evidence,
                    version: "V" + next.version,
                  },
                ),
              s.deliveries,
            )
          : ["edit", "reject", "respond", "change"].includes(a.kind)
            ? next.rows.reduce(
                (deliveries, _, n) =>
                  ["edit", "reject"].includes(a.kind) && n !== index
                    ? deliveries
                    : invalidateDelivery({ ...s, deliveries }, a.id + ":" + n),
                s.deliveries,
              )
            : s.deliveries,
      audit: [
        {
          ...log(
            a.kind,
            `${a.id}${a.index === undefined ? "" : ":" + (index + 1)}`,
            before,
            after,
            a.note || a.evidence || "本地合成资料操作",
            a.actor,
          ),
          version: next.version,
        },
        ...s.audit,
      ],
    };
  }
  if (a.type === "settings") return { ...s, settings: a.settings };
  if (a.type === "reset")
    return {
      ...initialState(a.settings),
      accountId: s.accountId,
      activity: s.activity,
      role: s.role,
      theme: s.theme,
      knowledge: s.knowledge,
      resources: s.resources,
      followups: s.followups,
      deliveries: s.deliveries.map((d) =>
        d.projectId === s.currentProjectId ? { ...d, outdated: true } : d,
      ),
      bookmarks: s.bookmarks,
      projects: s.projects.map((p) =>
        p.id === s.currentProjectId ? { ...p, snapshot: undefined } : p,
      ),
      currentProjectId: s.currentProjectId,
      stageStates: Object.fromEntries(
        stagesForProject(s.currentProjectId).map((d) => [
          d.id,
          {
            generated: false,
            version: 1,
            rows: d.outputs.map((r) => ({ ...r, status: "waiting" as const })),
            written: false,
            change: false,
            assigned: false,
          },
        ]),
      ),
    };
  if (a.type === "start") {
    if (s.running) return s;
    return { ...s, running: true, events: [], run: s.run + 1 };
  }
  if (a.type === "event") return { ...s, events: [...s.events, a.message] };
  if (a.type === "finish")
    return {
      ...s,
      running: false,
      generated: true,
      rows: s.rows.map((r) =>
        !a.ids || a.ids.includes(r.id)
          ? {
              ...r,
              text:
                r.status === "rejected"
                  ? `${initialRows.find((original) => original.id === r.id)?.text || r.text}\n重生成复核关注：${r.note}`
                  : r.text,
              status: "waiting",
              revision: s.generated ? r.revision + 1 : r.revision,
              note: "",
            }
          : r,
      ),
    };
  if (s.running) return s;
  if (a.type === "review") {
    const row = s.rows.find((r) => r.id === a.id);
    if (!row || !s.generated || !a.actor.trim() || !a.note.trim()) return s;
    if (a.action === "approve" && blocked(row, s)) return s;
    if (a.action === "edit" && !a.text?.trim()) return s;
    const next = {
      ...row,
      text: a.action === "edit" ? a.text!.trim() : row.text,
      status:
        a.action === "approve"
          ? ("approved" as const)
          : a.action === "reject"
            ? ("rejected" as const)
            : ("waiting" as const),
      note: a.note,
      revision: a.action === "edit" ? row.revision + 1 : row.revision,
    };
    return {
      ...s,
      rows: s.rows.map((r) => (r.id === row.id ? next : r)),
      facts:
        a.action === "approve"
          ? s.facts
          : s.facts.filter((f) => f.id !== row.id),
      audit: [
        {
          ...log(a.action, row.id, row.text, next.text, a.note, a.actor),
          previousStatus: row.status,
          nextStatus: next.status,
        },
        ...s.audit,
      ],
    };
  }
  if (a.type === "respond") {
    if (
      !["Q-01", "Q-02"].includes(a.id) ||
      !s.generated ||
      !a.text.trim() ||
      !a.evidence.trim() ||
      !a.actor.trim()
    )
      return s;
    const req = a.id === "Q-01" ? "REQ-04" : "REQ-06";
    return {
      ...s,
      facts: s.facts.filter((f) => f.req !== req),
      clarified: {
        ...s.clarified,
        [a.id]: { text: a.text, evidence: a.evidence },
      },
      modelConfirmed: a.id === "Q-01" ? false : s.modelConfirmed,
      rows: s.rows.map((r) =>
        r.req === req
          ? {
              ...r,
              status: "waiting",
              revision: r.revision + 1,
              text:
                r.artifact === "customer"
                  ? `待复核应答（据人工澄清）：${a.text.replace(/[。；]+$/, "")}。适用能力与承诺边界须由责任人确认。`
                  : r.text,
            }
          : r,
      ),
      audit: [
        log(
          "respond",
          a.id,
          s.clarified[a.id]?.text || "未答复",
          a.text,
          a.evidence,
          a.actor,
        ),
        ...s.audit,
      ],
    };
  }
  if (a.type === "model") {
    if (!s.generated || !s.clarified["Q-01"] || !a.actor.trim()) return s;
    return {
      ...s,
      modelConfirmed: true,
      audit: [
        log(
          "confirm",
          "DEMO-CAP-01",
          "未确认",
          "演示假设已复核",
          "仅用于合成项目；正式规格待模型验证。",
          a.actor,
        ),
        ...s.audit,
      ],
    };
  }
  if (a.type === "write") {
    if (!canWrite(s) || !a.actor.trim()) return s;
    return {
      ...s,
      facts: s.rows
        .filter((r) => r.artifact !== "server")
        .map((r) => ({ ...r })),
      changeStatus: Object.fromEntries(
        Object.entries(s.changeStatus).map(([id, status]) => [
          id,
          status === "reviewing" ? "done" : status,
        ]),
      ),
      audit: [
        log(
          "write",
          "项目事实",
          `${s.facts.length} 条`,
          `${s.rows.filter((r) => r.artifact !== "server").length} 条`,
          "已复核的合成项目事实快照；不构成外发批准。",
          a.actor,
        ),
        ...s.audit,
      ],
    };
  }
  if (a.type === "change") {
    const change = changes.find((c) => c.id === a.id);
    if (!change || s.changeStatus[a.id] === "done") return s;
    const applying =
      a.status === "reviewing" && s.changeStatus[a.id] !== "reviewing";
    const version = applying ? Math.max(7, s.sourceVersion) : s.sourceVersion;
    const affected = s.rows
      .filter((r) => change.reqs.includes(r.req))
      .map((r) => r.id);
    const clarified = { ...s.clarified };
    if (applying) delete clarified[a.id === "D-01" ? "Q-01" : "Q-02"];
    return {
      ...s,
      sourceVersion: version,
      clarified,
      modelConfirmed: applying && a.id === "D-01" ? false : s.modelConfirmed,
      rows: applying
        ? s.rows.map((r) =>
            affected.includes(r.id)
              ? {
                  ...r,
                  status: "waiting",
                  version,
                  revision: r.revision + 1,
                  text:
                    r.artifact === "customer"
                      ? `新版要求：${change.after} 待重新澄清与复核，不沿用旧版应答。`
                      : r.text,
                }
              : r,
          )
        : s.rows,
      facts: applying
        ? s.facts.filter((r) => !affected.includes(r.id))
        : s.facts,
      changeStatus: { ...s.changeStatus, [a.id]: a.status },
      audit: [
        log(
          a.status === "assigned" ? "assign" : "invalidate",
          change.id,
          s.changeStatus[a.id],
          a.status,
          `${change.owner}：${change.action}`,
          "项目协调人（演示）",
        ),
        ...s.audit,
      ],
    };
  }
  return s;
}
export interface Workbench {
  state: State;
  dispatch: React.Dispatch<Action>;
  runAgent: (ids?: string[]) => Promise<void>;
}
export const WorkbenchContext = createContext<Workbench | null>(null);
export function useWorkbench() {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("Workbench provider missing");
  return context;
}
