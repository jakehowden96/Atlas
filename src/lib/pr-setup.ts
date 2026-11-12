import type { ConnectorState } from "../types/generated/ConnectorState";
import type { RepoPrs } from "./stores/prs";

/** Why the Pull requests screen cannot show data, as the connector sees it. */
export type PrSetupProblem =
  | { kind: "noConnector" | "reconnect" | "offline" }
  | { kind: "rateLimited"; retryAt: number };

/** What the screen tells the user about a connector problem. */
export interface PrSetupHint {
  title: string;
  detail: string;
  /** The button to offer, or null when waiting is the only fix. */
  action: "connect" | "reconnect" | "retry" | null;
}

/**
 * The problem that stops every repo at once, if there is one. Timeouts and
 * other per-repo failures stay on their own cards. An empty `connectors` list
 * has not loaded yet, which is not a problem.
 */
export function setupProblem(
  connectors: ConnectorState[],
  repos: RepoPrs[] | null,
): PrSetupProblem | null {
  const prs = connectors.filter((c) => c.info.kind === "pullRequests");
  if (connectors.length > 0) {
    if (prs.some((c) => c.status.kind === "reconnectNeeded")) return { kind: "reconnect" };
    if (!prs.some((c) => c.status.kind === "linked")) return { kind: "noConnector" };
  }
  for (const { error } of repos ?? []) {
    if (error?.kind === "connectorRateLimited") {
      return { kind: "rateLimited", retryAt: error.retryAt ?? 0 };
    }
    if (error?.kind === "connectorOffline") return { kind: "offline" };
    if (error?.kind === "connectorReconnectNeeded" || error?.kind === "connectorNotLinked") {
      return { kind: "reconnect" };
    }
  }
  return null;
}

export function setupHint(problem: PrSetupProblem): PrSetupHint {
  switch (problem.kind) {
    case "noConnector":
      return {
        title: "Connect a pull request service",
        detail: "Atlas lists pull requests through a connector. Connect one in Settings.",
        action: "connect",
      };
    case "reconnect":
      return {
        title: "Reconnect your pull request service",
        detail: "The sign-in expired. Reconnect, then refresh.",
        action: "reconnect",
      };
    case "offline":
      return {
        title: "You are offline",
        detail: "Atlas will refresh pull requests when the connection is back.",
        action: "retry",
      };
    case "rateLimited":
      return {
        title: "Rate limit reached",
        detail: "The service is limiting requests. Pull requests refresh once the limit resets.",
        action: null,
      };
  }
}
