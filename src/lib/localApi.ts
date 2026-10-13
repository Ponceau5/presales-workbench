import {registerAccount} from "@/lib/accounts";
export const localApiBase = import.meta.env.VITE_API_BASE_URL || "";
async function serviceFetch(url: string, init: RequestInit) {
  try { return await fetch(url, init); }
  catch { throw new Error("无法连接协作服务，请稍后重试。输入内容已保留。"); }
}
const tokenKey = "presales-local-api-token";
const accountKey = "presales-local-api-account";

export function localApiReady(account: string | null) {
  return !!account && sessionStorage.getItem(accountKey) === account && !!sessionStorage.getItem(tokenKey);
}

export function clearLocalApiSession() {
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(accountKey);
  sessionStorage.removeItem("presales-person");
}

export async function connectLocalApi(username: string, password: string) {
  clearLocalApiSession();
  const response = await serviceFetch(`${localApiBase}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error("协作服务登录失败");
  const session = (await response.json()) as { token: string; account: string; person?:{id:string;display_name:string;role_name:Parameters<typeof registerAccount>[0]["role_name"];projects:{id:string;name:string}[];is_admin:number} };
  sessionStorage.setItem(tokenKey, session.token);
  sessionStorage.setItem(accountKey, session.account);
  if(session.person){sessionStorage.setItem("presales-person",JSON.stringify(session.person));registerAccount(session.person);}
}

export async function localApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(tokenKey);
  if (!token) throw new Error("请重新登录协作服务");
  if (init.method === "POST" && init.body instanceof FormData && /^\/api\/projects\/[^/]+\/documents$/.test(path)) {
    const status = await localApi<{direct_upload:boolean}>("/api/storage/status");
    const file = init.body.get("file");
    if (status.direct_upload && file instanceof File) {
      const prefix = path.replace(/\/documents$/, "/uploads");
      const prepared = await localApi<{id:string;url:string;headers:Record<string,string>}>(prefix+"/prepare", {
        method:"POST",body:JSON.stringify({filename:file.name,size:file.size,title:init.body.get("title"),version:init.body.get("version")}),
      });
      const uploaded = await fetch(prepared.url,{method:"PUT",headers:prepared.headers,body:file});
      if (!uploaded.ok) throw new Error("文件上传失败，请重试");
      return localApi<T>(prefix+"/"+prepared.id+"/complete",{method:"POST"});
    }
  }
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

export function currentPerson(): {id:string;display_name:string;role:string;is_admin:number;projects:{id:string;name:string}[]}|null {
 try{return JSON.parse(sessionStorage.getItem("presales-person")||"null");}catch{return null;}
}
