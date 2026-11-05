// Restart an expired OIDC transaction once; keep CSRF state validation intact.
const recoveryKey = "presales-login-recovery";
const recoveryWindowMs = 120_000;
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function claimLoginRecovery(storage: RecoveryStorage, now = Date.now()) {
  const previous = storage.getItem(recoveryKey);
  const startedAt = previous === null ? NaN : Number(previous);
  if (Number.isFinite(startedAt) && now - startedAt < recoveryWindowMs) return false;
  storage.setItem(recoveryKey, String(now));
  return true;
}
export function clearLoginRecovery(storage: RecoveryStorage) {
  storage.removeItem(recoveryKey);
}

export function identityLoginUrl(base: string, loginUrl: string, fresh: boolean, recover = false) {
  const separator = loginUrl.includes("?") ? "&" : "?";
  return base + loginUrl + (fresh ? separator + "fresh=1" : recover ? separator + "recover=1" : "");
}
export function requiresIdentityCompletion(search: string) {
  const query = new URLSearchParams(search);
  return query.has("casdoor") || query.has("login_error");
}
