export type ProjectProgress = {
  project_id: string;
  stage: "F5";
  status: string;
  next_action: string;
  document_count: number;
  latest_sources: { title: string; version: string }[];
  counts: Record<"candidate" | "verified" | "rejected" | "approved" | "published" | "stale", number>;
  pending_handoffs: number;
  stale_count: number;
  last_run: null | {
    id: string;
    model: string;
    pages: string;
    status: "running" | "completed" | "failed";
    candidate_count: number;
    skipped_count: number;
    error: string | null;
    started_at: string;
    finished_at: string | null;
  };
  scope: string;
};
