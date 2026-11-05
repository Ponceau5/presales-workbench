const pending = new Map<string, Promise<unknown>>();

export function shareWorkspaceRefresh<T>(scope: string, read: () => Promise<T>): Promise<T> {
  const active = pending.get(scope);
  if (active) return active as Promise<T>;
  const request = Promise.resolve().then(read).finally(() => {
    if (pending.get(scope) === request) pending.delete(scope);
  });
  pending.set(scope, request);
  return request;
}

export function workspaceRefreshPeriod(generating: boolean) {
  return generating ? 12_000 : 4_000;
}
