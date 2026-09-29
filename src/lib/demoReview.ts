import { initialRows, requirements } from "./presales";
import type { ReferenceItem } from "./referenceReview";
export const demoReviewItems: ReferenceItem[] = initialRows.map((r) => ({
  id: r.id,
  title: r.title,
  requirementType:
    requirements.find((q) => q.id === r.req)?.category === "原则类"
      ? "原则"
      : requirements.find((q) => q.id === r.req)?.category === "平台接入类"
        ? "接入"
        : "功能",
  capability: requirements.find((q) => q.id === r.req)?.capability,
  dependsOn:
    r.artifact === "customer"
      ? initialRows
          .filter(
            (other) =>
              other.req === r.req &&
              (other.artifact === "dev" || other.artifact === "clarification"),
          )
          .map((other) => other.id)
      : r.artifact === "dev" || r.artifact === "server"
        ? initialRows
            .filter(
              (other) =>
                other.req === r.req && other.artifact === "clarification",
            )
            .map((other) => other.id)
        : [],
  category: (
    {
      customer: "客户应答",
      clarification: "澄清",
      dev: "研发路径",
      server: "服务器",
    } as const
  )[r.artifact],
  requirement: requirements.find((q) => q.id === r.req)?.clause || r.title,
  draft: r.text,
  document: "bms-spec",
  page: 1,
  source: r.evidence,
  owner: r.owner,
  blocker: r.blocker
    ? {
        video: "视频范围与接口条件未确认",
        kafka: "Kafka 部署条件未确认",
        model: "容量参数与模型未确认",
      }[r.blocker]
    : undefined,
}));
