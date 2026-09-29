import { useWorkbench } from "@/state/workbench";
import { useState } from "react";
export default function Activity() {
  const { state } = useWorkbench();
  const [mine, setMine] = useState(false);
  const rows = state.activity.filter(
    (a) => !mine || a.accountId === state.accountId,
  );
  return (
    <section className="activity-page">
      <header className="dashboard-heading">
        <h1>操作记录</h1>
        <label>
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />{" "}
          仅看我的操作
        </label>
      </header>
      <div className="point-table-wrap">
        <table className="point-table">
          <thead>
            <tr>
              <th>时间 / 账号</th>
              <th>项目 / 对象</th>
              <th>操作</th>
              <th>修改内容</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {new Date(a.at).toLocaleString("zh-CN")}
                  <p>
                    {a.accountId} · {a.role}
                  </p>
                </td>
                <td>
                  {a.projectId}
                  <p>
                    {a.action === "followup"
                      ? "跟进事项"
                      : state.deliveries.find((d) => d.id === a.target)
                          ?.title || a.target}
                  </p>
                </td>
                <td>
                  {(
                    {
                      agentRun: "Agent 任务",
                      deliveryReceive: "处理交接",
                      publishSoftware: "交付软件工件",
                      approve: "批准",
                      edit: "修改",
                      reject: "驳回",
                      respond: "答复",
                      write: "写回",
                      generate: "生成初稿",
                      resource: "登记资料",
                      followup: "加入跟进",
                      followupComplete: "完成跟进",
                      followupAccept: "已阅答复",
                      knowledge: "共享知识",
                      knowledgeApprove: "知识审核",
                      projectCreate: "新建项目",
                      assign: "分派",
                      change: "版本变更",
                      settings: "连接设置",
                      reset: "重置",
                    } as Record<string, string>
                  )[a.action] || a.action}
                </td>
                <td>
                  <details>
                    <summary>查看前后内容</summary>
                    <pre>之前：{a.before || "—"}</pre>
                    <pre>之后：{a.after || "—"}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="index-empty">尚无操作记录。</p>}
      </div>
    </section>
  );
}
