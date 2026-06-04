export type CiState = "passed" | "failed" | "pending" | "none";
export type ReviewState = "approved" | "changes_requested" | "review_required" | "none";

/** One open pull request, flattened by the Rust command from gh's JSON. */
export interface Pr {
  number: number;
  title: string;
  url: string;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  headRefName: string;
  ciState: CiState;
  reviewState: ReviewState;
  commentsCount: number;
}

/** Per-repo result. `error` carries gh's stderr when the call failed. */
export interface RepoPrs {
  repo: string;
  prs: Pr[];
  error: string | null;
}

/** What PrsView holds in component state. */
export interface PrsSnapshot {
  data: RepoPrs[] | null;
  lastUpdated: number | null;
  loading: boolean;
}
