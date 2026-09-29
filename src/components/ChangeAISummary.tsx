import { useState } from "react";
import { Bot, ChevronDown } from "lucide-react";
import { alignLines } from "@/lib/lineDiff";
import type { LogEntry } from "@/lib/projectChanges";
import { referenceChanges } from "@/lib/referenceChanges";
export function ChangeAISummary({
  entry,
  before,
  after,
}: {
  entry: LogEntry;
  before: string;
  after: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = alignLines(before, after);
  const added = rows.filter((r) => r.left === undefined).length;
  const removed = rows.filter((r) => r.right === undefined).length;
  const modified = rows.filter(
    (r) => r.changed && r.left !== undefined && r.right !== undefined,
  ).length;
  const config = entry.id.startsWith("RC-N0906");
  return (
    <section className="change-ai-summary">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bot size={16} />
        <strong>AI 总结</strong>
        <span>Mock</span>
        <small>
          {added} 新增 · {removed} 删除 · {modified} 修改
        </small>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="change-ai-body">
          <div>
            <h3>变化概览</h3>
            <p>
              {config
                ? "配置由 07/20 更新至 09/06。服务器配置、采集设备数量及供货范围变化，需同步复核技术配置与 BOQ；以下内容为对比辅助意见。"
                : entry.title +
                  "发生修订。完整工件保留未修改条目，需按本次高亮内容复核。"}
            </p>
          </div>
          <div>
            <h3>关键变化</h3>
            {config ? (
              <ul>
                {referenceChanges
                  .filter((c) => c.id.startsWith("RC-N0906"))
                  .map((c) => (
                    <li key={c.id}>
                      <strong>{c.title}</strong>
                      <span>
                        {c.before} → {c.after}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p>
                {entry.before} → {entry.after}
              </p>
            )}
          </div>
          <div>
            <h3>影响与动作</h3>
            <p>
              {entry.affected.join(" / ")} · {entry.owner}
            </p>
            <ul>
              <li>
                核对受影响行的型号、数量与供货边界，保留其他条目的已确认状态。
              </li>
              <li>将差异提交责任岗位复核，更新对应工件版本和项目事实。</li>
              <li>
                客户应答、价格或交付承诺变化时，补齐批准依据后再对外使用。
              </li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
