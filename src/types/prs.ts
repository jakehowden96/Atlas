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

/** The signed-in GitHub user. */
export interface GhViewer {
  login: string;
}

/**
 * Why a `gh` call produced nothing. `not_installed` and `not_authenticated`
 * are fixed outside Atlas, so the UI shows the command that fixes them;
 * `message` is gh's own stderr (or Atlas's description) for the other two.
 */
export type GhErrorKind = "not_installed" | "not_authenticated" | "timed_out" | "failed";

export interface GhError {
  kind: GhErrorKind;
  message: string;
}

/** The answer to "who is signed in": the user, or why there is none. */
export interface GhViewerResult {
  viewer: GhViewer | null;
  error: GhError | null;
}

/** Per-repo result. `error` describes the failed `gh` call for that repo alone. */
export interface RepoPrs {
  repo: string;
  prs: Pr[];
  error: GhError | null;
}

/**
 * A git repo Atlas can act in: a workspace that is itself a checkout, or a
 * repo one directory inside one. `slug` is what a PR card is matched against
 * to find where "Work on it" should start its session.
 */
export interface WorkspaceRepo {
  path: string;
  slug: string | null;
}
