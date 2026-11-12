import { describe, expect, it } from "vitest";
import { setupHint, setupProblem } from "../pr-setup";
import type { ConnectorState } from "../../types/generated/ConnectorState";
import type { PrRepoError, RepoPrs } from "../stores/prs";

function connector(status: ConnectorState["status"]): ConnectorState {
  return {
    info: { id: "github", name: "GitHub", kind: "pullRequests", flow: "browser", configured: true },
    status,
  } as ConnectorState;
}

const LINKED = connector({ kind: "linked", account: "octocat" });

function repo(error: PrRepoError | null): RepoPrs {
  return { repo: "o/r", prs: [], error };
}

describe("setupProblem", () => {
  it("is null while nothing is wrong, and before connectors load", () => {
    expect(setupProblem([], null)).toBeNull();
    expect(setupProblem([LINKED], [repo(null)])).toBeNull();
  });

  it("reads the connector's own state", () => {
    expect(setupProblem([connector({ kind: "notLinked" })], null)).toEqual({ kind: "noConnector" });
    expect(setupProblem([connector({ kind: "reconnectNeeded", reason: "x" })], null)).toEqual({
      kind: "reconnect",
    });
  });

  it("finds rate limits, offline and expired sign-ins in any repo", () => {
    const limited = { kind: "connectorRateLimited", message: "slow", retryAt: 99 };
    expect(setupProblem([LINKED], [repo(null), repo(limited)])).toEqual({
      kind: "rateLimited",
      retryAt: 99,
    });
    expect(setupProblem([LINKED], [repo({ kind: "connectorOffline", message: "x" })])).toEqual({
      kind: "offline",
    });
    expect(
      setupProblem([LINKED], [repo({ kind: "connectorReconnectNeeded", message: "x" })]),
    ).toEqual({ kind: "reconnect" });
  });

  it("leaves a per-repo failure on its own card", () => {
    expect(setupProblem([LINKED], [repo({ kind: "connectorRemote", message: "x" })])).toBeNull();
    expect(setupProblem([LINKED], [repo({ kind: "timeout", message: "x" })])).toBeNull();
  });
});

describe("setupHint", () => {
  it("offers the fix that matches the problem", () => {
    expect(setupHint({ kind: "noConnector" }).action).toBe("connect");
    expect(setupHint({ kind: "reconnect" }).action).toBe("reconnect");
    expect(setupHint({ kind: "offline" }).action).toBe("retry");
  });

  it("offers nothing for a rate limit", () => {
    expect(setupHint({ kind: "rateLimited", retryAt: 1 }).action).toBeNull();
  });
});
