import {
  dependencyGate,
  initialReferenceReview,
  referenceItems,
  type ReferenceReviewState,
} from "./referenceReview";
import { demoReviewItems } from "./demoReview";
import type { State } from "@/state/workbench";
export function reviewKey(projectId: string) {
  return projectId === "RCJM1"
    ? "presales-rcjm1-review-20260928-v1"
    : "presales-review-" + projectId;
}
export function readProjectReview(
  projectId: string,
  state: State,
): ReferenceReviewState {
  const items = projectId === "RCJM1" ? referenceItems : demoReviewItems;
  const snapshot =
    projectId === state.currentProjectId
      ? state
      : state.projects.find((p) => p.id === projectId)?.snapshot;
  let review = initialReferenceReview(items);
  let saved = false;
  try {
    const value = JSON.parse(
      localStorage.getItem(reviewKey(projectId)) ||
        sessionStorage.getItem(reviewKey(projectId)) ||
        "null",
    );
    if (value?.rows && items.every((i) => value.rows[i.id])) {
      review = value;
      saved = true;
    }
  } catch {
    /* baseline */
  }
  if (projectId !== "RCJM1" && !saved && snapshot?.generated) {
    for (const i of items) {
      const row = snapshot.rows.find((r) => r.id === i.id);
      if (!row) continue;
      review.rows[i.id] = {
        text: row.text,
        note: row.note,
        evidence: row.evidence,
        status: row.status,
        written: snapshot.facts.some(
          (f) => f.id === i.id && f.revision === row.revision,
        ),
        resolution:
          row.blocker === "video"
            ? snapshot.clarified["Q-01"]?.text || ""
            : row.blocker === "kafka"
              ? snapshot.clarified["Q-02"]?.text || ""
              : "",
        revision: row.revision,
      };
    }
  }
  if (projectId !== "RCJM1" && snapshot) {
    if (
      review.sourceVersion &&
      review.sourceVersion !== snapshot.sourceVersion
    ) {
      for (const i of items.filter(
        (i) => i.blocker?.includes("视频") || i.category === "服务器",
      ))
        review.rows[i.id] = {
          ...review.rows[i.id],
          status: "waiting",
          written: false,
          resolution: "",
          revision: review.rows[i.id].revision + 1,
        };
    }
    review.sourceVersion = snapshot.sourceVersion;
  }
  for (const item of items) {
    if (
      review.rows[item.id].written &&
      (dependencyGate(item, review) ||
        (item.category === "客户应答" &&
          review.rows[item.id].extraction?.status !== "confirmed"))
    )
      review.rows[item.id] = {
        ...review.rows[item.id],
        written: false,
        status: "waiting",
        dependencyVersions: undefined,
      };
  }
  return review;
}
