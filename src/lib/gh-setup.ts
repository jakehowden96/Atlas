import type { GhError } from "../types/generated/GhError";
import type { RepoPrs } from "../types/generated/RepoPrs";

/** What the Pull requests screen tells the user to do about a `gh` problem. */
export interface GhSetupHint {
  title: string;
  detail: string;
  /** Shell commands to run, in order. */
  commands: string[];
}

/**
 * The problem that stops every repo at once, if there is one: `gh` missing or
 * signed out. Timeouts and per-repo failures stay on their own cards.
 */
export function setupProblem(repos: RepoPrs[] | null, viewerError: GhError | null): GhError | null {
  const blocking = (e: GhError | null): e is GhError =>
    e?.kind === "not_installed" || e?.kind === "not_authenticated";
  if (blocking(viewerError)) return viewerError;
  for (const repo of repos ?? []) {
    if (blocking(repo.error)) return repo.error;
  }
  return null;
}

export function setupHint(problem: GhError, isMac: boolean): GhSetupHint | null {
  switch (problem.kind) {
    case "not_installed":
      return {
        title: "The GitHub CLI (gh) is not installed",
        detail: "Atlas lists pull requests through gh. Install it, sign in, then refresh.",
        commands: [isMac ? "brew install gh" : "winget install --id GitHub.cli", "gh auth login"],
      };
    case "not_authenticated":
      return {
        title: "The GitHub CLI (gh) is not signed in",
        detail: "Sign in with gh, then refresh.",
        commands: ["gh auth login"],
      };
    default:
      return null;
  }
}
