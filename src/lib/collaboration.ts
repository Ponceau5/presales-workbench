import type { State } from "@/state/workbench";
import type { Role } from "./workspace";
import { routeTargets, routeRecipients, workflowRoutes } from "./workflowEngine";
export interface Delivery {
  id: string;
  projectId: string;
  artifactId: string;
  title: string;
  fromStage: string;
  toStage: string;
  sender: string;
  senderRole: Role;
  owner: Role;
  version: string;
  text: string;
  evidence: string;
  at: string;
  status: "pending" | "accepted" | "returned";
  outdated: boolean;
  receivedBy?: string;
  receivedAt?: string;
  note?: string;
}
export const downstream = workflowRoutes;
export function recipients(stage: string): Role[] {
  return routeRecipients(stage);
}
export function publishDelivery(
  s: State,
  input: Pick<
    Delivery,
    "artifactId" | "title" | "fromStage" | "text" | "evidence" | "version"
  >,
  targets = routeTargets(input.fromStage),
): Delivery[] {
  let deliveries = s.deliveries || [];
  for (const toStage of targets)
    for (const owner of recipients(toStage)) {
      if (toStage === input.fromStage && owner === s.role) continue;
      const previous = deliveries.find(
        (d) =>
          d.projectId === s.currentProjectId &&
          d.artifactId === input.artifactId &&
          d.toStage === toStage &&
          d.owner === owner &&
          !d.outdated,
      );
      if (
        previous &&
        previous.text === input.text &&
        previous.evidence === input.evidence
      )
        continue;
      deliveries = deliveries.map((d) =>
        d.projectId === s.currentProjectId &&
        d.artifactId === input.artifactId &&
        d.toStage === toStage &&
        d.owner === owner
          ? { ...d, outdated: true }
          : d,
      );
      deliveries = [
        {
          ...input,
          id: crypto.randomUUID(),
          projectId: s.currentProjectId,
          toStage,
          owner,
          sender: s.accountId!,
          senderRole: s.role,
          at: new Date().toISOString(),
          status: "pending",
          outdated: false,
        },
        ...deliveries,
      ];
    }
  return deliveries;
}
export function invalidInputs(s: State, stage: string) {
  return (s.deliveries || []).filter(
    (d) =>
      d.projectId === s.currentProjectId &&
      d.toStage === stage &&
      d.status === "accepted" &&
      d.outdated,
  );
}
export function invalidateDelivery(s: State, artifactId: string): Delivery[] {
  return (s.deliveries || []).map((d) =>
    d.projectId === s.currentProjectId && d.artifactId === artifactId
      ? { ...d, outdated: true }
      : d,
  );
}
export function acceptedInputs(
  s: State,
  projectId: string,
  stage: string,
): Delivery[] {
  return (s.deliveries || []).filter(
    (d) =>
      d.projectId === projectId &&
      d.toStage === stage &&
      d.status === "accepted" &&
      !d.outdated,
  );
}
