export const localApiBase = import.meta.env.DEV ? "" : "http://127.0.0.1:8000";
async function serviceFetch(url: string, init: RequestInit) {
  try { return await fetch(url, init); }
  catch { throw new Error("无法连接本机协作服务，请检查 8000 后端服务后重试。输入内容已保留。"); }
}
const tokenKey = "presales-local-api-token";
const accountKey = "presales-local-api-account";

export function localApiReady(account: string | null) {
  return !!account && sessionStorage.getItem(accountKey) === account && !!sessionStorage.getItem(tokenKey);
}

export function clearLocalApiSession() {
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(accountKey);
}

export async function connectLocalApi(username: string, password: string) {
  clearLocalApiSession();
  const response = await serviceFetch(`${localApiBase}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error("本机协作服务登录失败");
  const session = (await response.json()) as { token: string; account: string };
  sessionStorage.setItem(tokenKey, session.token);
  sessionStorage.setItem(accountKey, session.account);
}

export async function localApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(tokenKey);
  if (!token) throw new Error("请启动本机协作服务后重新登录");
  const response = await serviceFetch(`${localApiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}
