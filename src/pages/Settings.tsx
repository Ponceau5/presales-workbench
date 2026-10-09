import { reviewKey } from "@/lib/projectReview";
import { canManageConnection } from "@/lib/accounts";
import { useEffect, useState } from "react";
import { localApi, localApiReady } from "@/lib/localApi";
import {
  Cable,
  ShieldAlert,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import {
  PROVIDERS,
  saveSettings,
  testLiveConnection,
  type ProviderId,
  type LLMSettings,
} from "@/lib/presales";
import { Heading, Section, Tag } from "@/components/WorkbenchUI";
export default function Settings() {
  const { state, dispatch } = useWorkbench();
  const s = state.settings;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [reset, setReset] = useState(false);
  const [serverModel, setServerModel] = useState<{ configured: boolean; model: string } | null>(null);
  const [serverTesting, setServerTesting] = useState(false);
  const [serverResult, setServerResult] = useState<string | null>(null);
  const serverReady = localApiReady(state.accountId);
  useEffect(() => {
    if (!serverReady) return;
    let active = true;
    void localApi<{ configured: boolean; model: string }>("/api/model/status")
      .then((value) => { if (active) setServerModel(value); })
      .catch(() => { if (active) setServerModel(null); });
    return () => { active = false; };
  }, [serverReady]);
  async function testServerModel() {
    setServerTesting(true);
    setServerResult(null);
    try {
      await localApi("/api/model/test", { method: "POST" });
      setServerResult("Kimi 连接成功");
    } catch (error) {
      setServerResult(error instanceof Error ? error.message : "连接失败");
    } finally {
      setServerTesting(false);
    }
  }
  function update(patch: Partial<LLMSettings>) {
    if (!canManageConnection(state.role)) return;
    const settings = { ...s, ...patch };
    dispatch({ type: "settings", settings });
    saveSettings(settings);
    setResult(null);
  }
  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await testLiveConnection(s) });
    } catch (e) {
      setResult({
        ok: false,
        text: e instanceof Error ? e.message : "连接失败",
      });
    } finally {
      setTesting(false);
    }
  }
  if (!canManageConnection(state.role))
    return (
      <Heading
        eyebrow=""
        title="连接设置"
        description="由 PM / PO 账号维护连接配置。"
      />
    );
  return (
    <>
      <Heading
        eyebrow="RUNTIME / CONNECTION"
        title="连接与运行"
        description="本地完成演示，按需验证模型连接。"
        action={<Tag tone="teal">{s.mode.toUpperCase()}</Tag>}
      />
      <div className="settings-layout">
        <div>
          <Section title="运行模式">
            <div className="mode-cards">
              {(["mock", "live"] as const).map((mode) => (
                <button
                  key={mode}
                  className={`mode-card ${s.mode === mode ? "selected" : ""}`}
                  disabled={testing}
                  onClick={() => update({ mode })}
                >
                  <span>
                    {mode === "mock" ? "本地 Mock" : "Live 连接验证"}
                    {s.mode === mode ? <CheckCircle2 size={17} /> : null}
                  </span>
                  <p>
                    {mode === "mock"
                      ? "无需 Key，完整演示生成、人审、写回与变更。"
                      : "测试 chat/completions 连通性；业务执行仍使用 Mock。"}
                  </p>
                </button>
              ))}
            </div>
          </Section>
          <Section title="模型连接" extra={<Cable size={17} />}>
            <fieldset disabled={testing}>
              <div className="form-grid">
                <label className="form-label">
                  Provider
                  <select
                    value={s.provider}
                    onChange={(e) => {
                      const provider = e.target.value as ProviderId;
                      update({
                        provider,
                        baseUrl: PROVIDERS[provider].baseUrl,
                        model: PROVIDERS[provider].model,
                        apiKey: "",
                        allowBrowserKey: false,
                      });
                    }}
                  >
                    {Object.entries(PROVIDERS).map(([id, p]) => (
                      <option key={id} value={id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Model
                  <input
                    placeholder="填写该接口实际可用的模型名称"
                    value={s.model}
                    onChange={(e) => update({ model: e.target.value })}
                  />
                </label>
              </div>
              <label className="form-label">
                Base URL
                <input
                  placeholder="https://your-gateway.example/v1"
                  value={s.baseUrl}
                  onChange={(e) =>
                    update({
                      baseUrl: e.target.value,
                      apiKey: "",
                      allowBrowserKey: false,
                    })
                  }
                />
              </label>
              <label className="form-label">
                API Key · 仅保存在本页内存
                <input
                  type="password"
                  autoComplete="off"
                  value={s.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="输入测试 Key"
                />
              </label>
              <p className="muted small">
                刷新后 Key 自动清空。修改接口地址或 Provider 会清空 Key
                与直连许可。
              </p>
              <div className="security-consent">
                <label>
                  <input
                    type="checkbox"
                    checked={s.allowBrowserKey}
                    onChange={(e) =>
                      update({ allowBrowserKey: e.target.checked })
                    }
                  />
                  允许向上方地址直连测试
                </label>
                <p>
                  将向 {s.baseUrl || "未填写地址"} 发送 Key 与
                  ping。请确认该地址是你信任的接口。
                </p>
              </div>
              <button
                className="btn primary"
                disabled={
                  s.mode !== "live" ||
                  !s.allowBrowserKey ||
                  !s.apiKey.trim() ||
                  !s.model.trim() ||
                  testing
                }
                onClick={test}
              >
                {testing ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Cable size={16} />
                )}{" "}
                {testing ? "连接测试中" : "测试连接"}
              </button>
            </fieldset>
            {result ? (
              <div
                role="status"
                className={`connection-result ${result.ok ? "ok" : "error"}`}
              >
                {result.text}
              </div>
            ) : null}
          </Section>
        </div>
        <div>
          <Section title="服务端 Kimi">
            <p>{!serverReady ? "本机 API 未连接" : serverModel?.configured ? `${serverModel.model} · 已配置` : "未配置 API Key"}</p>
            <button className="btn secondary" disabled={!serverModel?.configured || serverTesting} onClick={() => void testServerModel()}>
              {serverTesting ? "测试中" : "测试服务端连接"}
            </button>
            {serverResult && <p role="status">{serverResult}</p>}
            <p className="muted small">F5 原文提取使用服务端 Key；只在 `.env.local` 配置。</p>
          </Section>
          <Section title="浏览器 Key 仅适用于原型">
            <div className="security-note">
              <ShieldAlert size={26} />
              <h3>正式版使用服务端 Runtime</h3>
              <p>
                浏览器直连可暴露 Key，且可能遇到 CORS 限制。F5 已通过本机
                API 使用服务端 Key；其他业务执行仍待接入。
              </p>
              <p>
                上方浏览器连接测试只发送固定短句，不发送项目资料。
              </p>
              <Tag tone="amber">PROTOTYPE ONLY</Tag>
            </div>
          </Section>
          <Section title="演示管理">
            <p className="muted small">
              项目状态与账号操作记录保留在本标签页。刷新保留，关闭标签页后结束演示会话。
            </p>
            {reset ? (
              <div className="reset-confirm">
                <p>确认清空本次生成、人审、行动与写回记录？</p>
                <button
                  className="btn secondary"
                  onClick={() => {
                    sessionStorage.removeItem(
                      reviewKey(state.currentProjectId),
                    );
                    dispatch({ type: "reset", settings: s });
                    setReset(false);
                  }}
                >
                  确认重置
                </button>
                <button className="btn mini" onClick={() => setReset(false)}>
                  取消
                </button>
              </div>
            ) : (
              <button
                className="btn secondary"
                disabled={state.running || testing}
                onClick={() => setReset(true)}
              >
                <RotateCcw size={15} />
                重置演示项目
              </button>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
