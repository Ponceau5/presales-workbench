import { configVersions } from "./configVersions";
export interface DeploymentModel {
  interval: number;
  ratio: number;
  bytes: number;
}
export function defaultDeploymentModel(projectId: string): DeploymentModel {
  return projectId === "RCJM1"
    ? { interval: 60, ratio: 50, bytes: 32 }
    : { interval: 5, ratio: 100, bytes: 8 };
}
export function deploymentContext(projectId: string, model: DeploymentModel) {
  const real = projectId === "RCJM1";
  const capacity =
    ((((((real ? 595644 : 10000) * (real ? 730 : 30) * 86400) /
      model.interval) *
      model.bytes *
      model.ratio) /
      100) *
      1.3 *
      (real ? 2 : 1)) /
    1e12;
  return `测点 ${real ? 595644 : 10000}，保留 ${real ? 730 : 30} 天；采集 ${model.interval} 秒，${model.bytes} 字节/记录，压缩后 ${model.ratio}%，预留30%，${real ? 2 : 1}份副本。估算 ${capacity.toFixed(3)} TB。全量等周期入库假设，未计 RAID 开销，参数与容量均未经正式模型验证。`;
}

export function referenceServerRows() {
  const version = configVersions.at(-1)!;
  return version.sheets
    .filter((s) => ["BMS", "DCOM"].includes(s.name))
    .flatMap((sheet) =>
      sheet.content
        .split("\n")
        .filter(
          (line) =>
            /^\d+ \|/.test(line) &&
            /服务器/.test(line.split(" | ")[1] || "") &&
            !/操作系统/.test(line.split(" | ")[1] || ""),
        )
        .map((line) => {
          const cells = line.split(" | ");
          return {
            title: cells[1],
            quantity: cells[sheet.name === "BMS" ? 5 : 6],
            spec: cells[2],
            environment:
              sheet.name === "BMS" ? "Linux / PostgreSQL" : "原记录未载",
            source: `${version.file} · ${sheet.name} · ${cells[0]}`,
          };
        }),
    );
}
