import type { State, ProjectSnapshot } from "@/state/workbench";
export const sharedKey = "presales-shared-workspace-v2";
const snapshotKeys: (keyof ProjectSnapshot)[] = [
  "stageStates",
  "rows",
  "generated",
  "run",
  "sourceVersion",
  "events",
  "clarified",
  "modelConfirmed",
  "audit",
  "facts",
  "changeStatus",
];
export function sharedWorkspace(s: State) {
  const snapshot = Object.fromEntries(
    snapshotKeys.map((k) => [k, s[k]]),
  ) as unknown as ProjectSnapshot;
  return {
    projects: s.projects.map((p) =>
      p.id === s.currentProjectId ? { ...p, snapshot } : p,
    ),
    activity: s.activity,
    followups: s.followups,
    deliveries: s.deliveries,
    resources: s.resources,
    knowledge: s.knowledge,
  };
}
export type SharedWorkspace = ReturnType<typeof sharedWorkspace>;
export function mergeShared(s: State, shared?: SharedWorkspace | null): State {
  if (!shared?.projects?.length) return s;
  const snapshot = shared.projects.find(
    (p) => p.id === s.currentProjectId,
  )?.snapshot;
  return {
    ...s,
    projects: shared.projects,
    activity: shared.activity || [],
    followups: shared.followups || [],
    resources: shared.resources || s.resources,
    knowledge: shared.knowledge || s.knowledge,
    ...(snapshot || {}),
    deliveries: shared.deliveries || [],
    running: s.running,
  };
}
export function loadShared(): SharedWorkspace | null {
  try {
    return JSON.parse(localStorage.getItem(sharedKey) || "null");
  } catch {
    return null;
  }
}
export function saveShared(s: State) {
  localStorage.setItem(sharedKey, JSON.stringify(sharedWorkspace(s)));
}
