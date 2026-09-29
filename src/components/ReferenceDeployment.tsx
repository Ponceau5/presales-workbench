import { referenceServerRows } from "@/lib/deploymentModel";
import type { DeploymentModel } from "@/lib/deploymentModel";

export function ReferenceDeployment({
  projectId = "RCJM1",
  model,
  onChange,
}: {
  projectId?: string;
  model: DeploymentModel;
  onChange: (model: DeploymentModel) => void;
}) {
  const real = projectId === "RCJM1";
  const points = real ? 595644 : 10000;
  const days = real ? 730 : 30;
  const { interval, ratio, bytes } = model;
  const setInterval = (interval: number) => onChange({ ...model, interval });
  const setRatio = (ratio: number) => onChange({ ...model, ratio });
  const setBytes = (bytes: number) => onChange({ ...model, bytes });
  const records = (points * days * 86400) / interval;
  const capacity =
    (((records * bytes * ratio) / 100) * 1.3 * (real ? 2 : 1)) / 1e12;
  return (
    <section className="reference-deployment">
      <header>
        <h3>部署配置</h3>
        <span>{real ? "配置基线 · 09/06" : "部署输入 V1"}</span>
      </header>
      <details className="deployment-baseline">
        <summary>服务器配置 · {real ? "5 组 / 10 台" : "待确认"}</summary>
        <div className="point-table-wrap">
          <table className="point-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>台数</th>
                <th>配置</th>
                <th>运行环境</th>
              </tr>
            </thead>
            <tbody>
              {real ? (
                referenceServerRows().map((r) => (
                  <tr key={r.title} title={r.source}>
                    <td>{r.title.split(" ")[0]}</td>
                    <td>{r.quantity}</td>
                    <td>{r.spec}</td>
                    <td>{r.environment}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td>监控平台</td>
                  <td>待确认</td>
                  <td>待模型验证</td>
                  <td>待确认</td>
                </tr>
              )}
              {real && (
                <tr>
                  <td>工程工作站</td>
                  <td>2</td>
                  <td>DELL T3680 · 24 寸显示器</td>
                  <td>Windows 11 Pro</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
      <div className="storage-estimate">
        <div>
          <h3>历史存储</h3>
          <p>
            {points.toLocaleString()} 点 · {days} 天 · 预留 30% ·{" "}
            {real ? "两份副本" : "单份原始点值"}
          </p>
        </div>
        <label>
          采集周期（秒）
          <input
            type="number"
            min="1"
            max="3600"
            value={interval}
            onChange={(e) =>
              setInterval(
                Math.max(1, Math.min(3600, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
        <label>
          字节 / 记录
          <input
            type="number"
            min="1"
            max="1024"
            value={bytes}
            onChange={(e) =>
              setBytes(Math.max(1, Math.min(1024, Number(e.target.value) || 1)))
            }
          />
        </label>
        <label>
          压缩后占比（%）
          <input
            type="number"
            min="1"
            max="100"
            value={ratio}
            onChange={(e) =>
              setRatio(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
            }
          />
        </label>
        <output>
          <strong>
            {capacity < 1 ? (capacity * 1000).toFixed(2) : capacity.toFixed(1)}
          </strong>
          <span>{capacity < 1 ? "GB" : "TB"}</span>
          <small>估算容量</small>
        </output>
      </div>
      <details className="storage-basis">
        <summary>演算依据</summary>
        <p>
          容量 = 测点 × 保留天数 × 86,400 ÷ 采集周期 × 字节/记录 × 压缩后占比 ×
          1.3 × 副本数。参数为演示假设；按全量等周期入库估算，不包含磁盘 RAID
          开销。原配置未载磁盘容量，OS/DB 偏离在澄清表复核。
        </p>
      </details>
    </section>
  );
}
