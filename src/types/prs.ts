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
  /** Logins of individually requested reviewers; team requests are dropped. */
  reviewRequestLogins: string[];
  commentsCount: number;
}

/** The signed-in GitHub user, or null when `gh` is missing or logged out. */
export interface GhViewer {
  login: string;
}

/** Per-repo result. `error` carries gh's stderr when the call failed. */
export interface RepoPrs {
  repo: string;
  prs: Pr[];
  error: string | null;
}
