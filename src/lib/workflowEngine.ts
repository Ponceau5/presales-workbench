import type { Role } from "./workspace";
import { stageRowOwners } from "./accounts";

// The project route is stable; each published artifact creates a separate handoff.
// F14 is a cross-cutting change process, so it is deliberately not a route node.
export const workflowRoutes: Record<string, readonly string[]> = {
  F1: ["F2"],
  F2: ["F3", "F4", "F5", "F6"],
  F3: ["F7"],
  F4: ["F7"],
  F5: ["F7", "F10"],
  F6: ["F7", "F11"],
  F7: ["F8"],
  F8: ["F9"],
  F9: ["F10"],
  F10: ["F11"],
  F11: ["F12"],
  F12: ["F13"],
  F13: [],
};

export type FlowStatus =
  | "not_started"
  | "reviewing"
  | "blocked"
  | "ready"
  | "published";

export interface FlowArtifact {
  generated: boolean;
  written: boolean;
  response?: { text: string; evidence: string };
  rows: { status: "waiting" | "approved" | "rejected" }[];
}

export interface FlowInput {
  projectId: string;
  toStage: string;
  status: "pending" | "accepted" | "returned";
  outdated: boolean;
}

export function routeTargets(stage: string): readonly string[] {
  return workflowRoutes[stage] || [];
}

export function routeRecipients(stage: string): Role[] {
  const owners =
    stage === "F5"
      ? (["软件产品", "研发", "解决方案"] as Role[])
      : stageRowOwners[stage] || [];
  return [...new Set(owners)];
}

export function stageFlow(
  artifact: FlowArtifact,
  inputs: readonly FlowInput[],
  projectId: string,
  stage: string,
): { status: FlowStatus; reason?: string } {
  if (
    inputs.some(
      (input) =>
        input.projectId === projectId &&
        input.toStage === stage &&
        input.status === "accepted" &&
        input.outdated,
    )
  )
    return { status: "blocked", reason: "已接收的上游版本失效" };
  if (artifact.written) return { status: "published" };
  if (!artifact.generated) return { status: "not_started" };
  if (artifact.rows.some((row) => row.status === "rejected"))
    return { status: "blocked", reason: "存在已驳回成果" };
  if (!artifact.response?.text.trim() || !artifact.response.evidence.trim())
    return { status: "reviewing", reason: "缺少确认记录与依据" };
  if (!artifact.rows.length || artifact.rows.some((row) => row.status !== "approved"))
    return { status: "reviewing", reason: "成果尚未全部复核" };
  return { status: "ready" };
}

export function canPublishStage(
  artifact: FlowArtifact,
  inputs: readonly FlowInput[],
  projectId: string,
  stage: string,
): boolean {
  return stageFlow(artifact, inputs, projectId, stage).status === "ready";
}

export function canReceiveInput(
  input: FlowInput & { owner: Role },
  role: Role,
  decision: "accepted" | "returned",
  note: string,
): boolean {
  if (input.owner !== role || input.status === "returned" || !note.trim())
    return false;
  if (decision === "accepted")
    return input.status === "pending" && !input.outdated;
  return input.status === "pending" || input.status === "accepted";
}
