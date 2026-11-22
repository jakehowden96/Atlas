/** Connector and pull-request data in the backend's wire shapes (what `invoke` returns). */
import type { Check } from "../../../types/generated/Check";
import type { ConnectorState } from "../../../types/generated/ConnectorState";
import type { PullRequest } from "../../../types/generated/PullRequest";

const github = {
  id: "github",
  name: "GitHub",
  kind: "pullRequests",
  flow: "browser",
  methods: ["oauth"],
  configured: true,
} as const satisfies ConnectorState["info"];

export const githubLinked: ConnectorState = {
  info: { ...github, methods: [...github.methods] },
  status: { kind: "linked", account: "octo" },
  method: "oauth",
};
export const githubNotLinked: ConnectorState = {
  ...githubLinked,
  status: { kind: "notLinked" },
  method: null,
};
export const githubExpired: ConnectorState = {
  ...githubLinked,
  status: { kind: "reconnectNeeded", reason: "token expired" },
};

export const workspace = { path: "/work/atlas", slug: "octo/atlas", branch: "feat/retry-after" };

export const check = (name: string, status: Check["status"]): Check => ({
  name,
  status,
  detailsUrl: `https://github.com/${workspace.slug}/actions/runs/1/${name}`,
});

const passing = ["lint", "typecheck", "unit (linux)", "unit (macos)", "unit (windows)", "build"];
export const checks = {
  failing: [check("e2e", "fail"), ...passing.map((n) => check(n, "pass"))],
  running: [check("e2e", "pending"), check("build", "pending"), ...passing.slice(0, 4).map((n) => check(n, "pass"))],
  passed: passing.map((n) => check(n, "pass")),
};

export function pull(over: Partial<PullRequest> = {}): PullRequest {
  const c = over.checks ?? checks.passed;
  return {
    number: 482,
    title: "Honor Retry-After on 429s from the connector",
    url: `https://github.com/${workspace.slug}/pull/482`,
    state: "open",
    headRefName: workspace.branch,
    author: "octo",
    isCrossRepository: false,
    ci: c.length === 0 ? null : c.some((x) => x.status === "fail") ? "fail" : c.some((x) => x.status === "pending") ? "pending" : "pass",
    checks: c,
    review: { kind: "awaiting" },
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-22T09:30:00Z",
    reviewRequestLogins: ["hubot"],
    commentsCount: 0,
    ...over,
  };
}
