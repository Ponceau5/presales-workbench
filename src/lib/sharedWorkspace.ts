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

export function scopeToProjects(s: State, permitted?: {id:string;name:string}[]): State {
  if (!permitted) return s;
  const ids = new Set(permitted.map(project => project.id));
  const belongs = (value: unknown) => {
    const row = value as {projectId?:string;project_id?:string};
    const project = row.projectId || row.project_id;
    return !project || ids.has(project);
  };
  const projects = s.projects.filter(project => ids.has(project.id));
  for (const project of permitted) {
    if (!projects.some(item => item.id === project.id))
      projects.push({...project,owner:s.role,updated:""});
  }
  return {...s,projects,activity:s.activity.filter(belongs),resources:s.resources.filter(belongs),
    followups:s.followups.filter(belongs),deliveries:s.deliveries.filter(belongs),knowledge:s.knowledge.filter(belongs)};
}
