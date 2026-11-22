/**
 * The design's fixture world (docs/design-handoff "Screens - Shell and Sessions"):
 * two workspaces, six sessions in every tile state, a linked ticket, a diff and
 * codeburn data. `seedWorld()` fills the stores; `worldBackend` answers the IPC.
 */
import type { LiveSession } from "../../../types/generated/LiveSession";
import type { ConnectorState } from "../../../types/generated/ConnectorState";
import type { PanelData } from "../../../types/generated/PanelData";
import type { Ticket } from "../../../types/generated/Ticket";
import type { PullRequest } from "../../../types/generated/PullRequest";
import type { PlanEntry } from "../../../types/generated/PlanEntry";
import type { DocEntry } from "../../../types/generated/DocEntry";
import { fileKey, slugifyPath } from "../../files";
import { openFiles } from "../../stores/file-tabs";
import { activeFile, fileWs } from "../../stores/files";
import type { TranscriptLine } from "../../../types/generated/TranscriptLine";
import type { Backend } from "../../../../.storybook/backend";
import { connectors } from "../../stores/connectors";
import { upsertLiveSession } from "../../stores/liveSessions";
import { tabs, permissionPromptTabs } from "../../stores/terminal";
import { tickets } from "../../stores/tickets";
import { activeView, focusedSessionId } from "../../stores/view";
import {
  activeWorkspacePath,
  sessionDiffStats,
  WORKSPACE_COLORS,
  workspaces,
  type Workspace,
} from "../../stores/workspace";
import { githubLinked, pull, checks } from "./prs";
import { get } from "svelte/store";
import { liveTiles } from "../../stores/liveTiles";
import type { SessionTile } from "../../overview";
import status from "../../components/app/stats/codeburn/__fixtures__/status.json";
import sessionsJson from "../../components/app/stats/codeburn/__fixtures__/sessions.json";
import report from "../../components/app/stats/codeburn/__fixtures__/report.json";
import models from "../../components/app/stats/codeburn/__fixtures__/models.json";
import compare from "../../components/app/stats/codeburn/__fixtures__/compare.json";
import comparePeriods from "../../components/app/stats/codeburn/__fixtures__/compare-periods.json";
import optimize from "../../components/app/stats/codeburn/__fixtures__/optimize.json";
import quota from "../../components/app/stats/codeburn/__fixtures__/quota.json";
import spend from "../../components/app/stats/codeburn/__fixtures__/spend.json";
import yieldJson from "../../components/app/stats/codeburn/__fixtures__/yield.json";
import plan from "../../components/app/stats/codeburn/__fixtures__/plan.json";

export const ATLAS = "/Users/dev/code/atlas";
export const BILLING = "/Users/dev/code/billing";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const linearLinked: ConnectorState = {
  info: {
    id: "linear",
    name: "Linear",
    kind: "tickets",
    flow: "browser",
    methods: ["oauth", "apiKey"],
    configured: true,
  },
  status: { kind: "linked", account: "dev@example.com" },
  method: "oauth",
};

export const ticket: Ticket = {
  id: "ENG-482",
  title: "Retry failed webhook deliveries with backoff",
  status: "In Progress",
  statusKind: "inProgress",
  url: "https://linear.app/example/issue/ENG-482",
  assignee: "dev",
};

const line = (text: string, role: TranscriptLine["role"] = "note"): TranscriptLine => ({
  role,
  text,
  timestamp: null,
});

export function live(over: Partial<LiveSession> & { sessionUuid: string }): LiveSession {
  return {
    state: "running",
    startedAt: ago(14),
    lastActivity: ago(0),
    title: null,
    model: "claude-sonnet-4-5",
    gitBranch: "main",
    worktree: null,
    lines: [],
    plan: [],
    subagents: [],
    toolCalls: 0,
    lastTool: null,
    pendingTool: null,
    outputTokens: 0,
    contextTokens: 0,
    peakContext: 0,
    contextPct: 0,
    lastPrompt: null,
    lastReply: null,
    turnEndedAt: null,
    turnDurationMs: null,
    prUrl: null,
    ...over,
  };
}

interface Seed {
  id: string;
  label: string;
  ws: string;
  diff: [number, number, number] | null;
  live: LiveSession;
  needs?: "permission_prompt" | "elicitation_dialog";
  ticket?: boolean;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SEEDS: Seed[] = [
  {
    id: "s-pinned",
    label: "pinned-tiles",
    ws: ATLAS,
    diff: [3, 41, 9],
    needs: "permission_prompt",
    live: live({
      sessionUuid: uuid(1),
      state: "needsYou",
      startedAt: ago(26),
      gitBranch: "atlas/pinned-tiles",
      toolCalls: 118,
      contextTokens: 82_000,
      contextPct: 0.41,
      lastTool: "Bash",
      pendingTool: { name: "Bash", inputSummary: "pnpm vitest run overview" },
      lines: [
        line("> Sort pinned tiles first on the overview", "user"),
        line("The sort lives in compareByAttention. I'll add a pinned key ahead of state."),
        line("* Edit src/lib/overview.ts", "tool"),
        line("* Bash pnpm vitest run overview", "tool"),
      ],
    }),
  },
  {
    id: "s-docs",
    label: "docs-refresh",
    ws: ATLAS,
    diff: [7, 120, 64],
    needs: "elicitation_dialog",
    live: live({
      sessionUuid: uuid(2),
      state: "idle",
      startedAt: ago(9),
      gitBranch: "docs/connectors",
      toolCalls: 34,
      contextTokens: 21_000,
      lastTool: "Write",
      turnEndedAt: ago(1),
      turnDurationMs: 312_000,
      lastReply:
        "Drafted all seven sections. Two links point at pages that no longer exist.\n\nShould I keep the old links as redirects?",
      lines: [
        line("> Rewrite the Settings copy for connectors", "user"),
        line(
          "Drafted all seven sections. Two links point at pages that no longer exist. Should I keep the old links as redirects?",
        ),
      ],
    }),
  },
  {
    id: "s-overview",
    label: "overview-sort",
    ws: ATLAS,
    diff: [1, 12, 3],
    live: live({
      sessionUuid: uuid(3),
      state: "error",
      startedAt: ago(41),
      gitBranch: "atlas/overview-sort",
      toolCalls: 77,
      contextTokens: 64_000,
      lastTool: "Bash",
      lines: [
        line("> Fix the flaky overview test", "user"),
        line("* Bash pnpm vitest run overview --reporter verbose", "tool"),
        line("  API error 529 · overloaded, the turn stopped", "alert"),
      ],
    }),
  },
  {
    id: "s-billing",
    label: "billing-retry",
    ws: BILLING,
    diff: [4, 86, 12],
    ticket: true,
    live: live({
      sessionUuid: uuid(4),
      state: "running",
      startedAt: ago(14),
      gitBranch: "atlas/billing-retry",
      toolCalls: 61,
      contextTokens: 56_000,
      contextPct: 0.28,
      lastTool: "Bash",
      pendingTool: { name: "Bash", inputSummary: "cargo test -p billing" },
      plan: [
        { text: "Read the webhook sender", status: "completed" },
        { text: "Add a retry helper with backoff", status: "completed" },
        { text: "Wrap sendWebhook in the helper", status: "completed" },
        { text: "Test the failure path", status: "in_progress" },
        { text: "Honor Retry-After", status: "pending" },
        { text: "Open the pull request", status: "pending" },
      ],
      subagents: [
        {
          task: "Write webhook failure test",
          agentType: "general-purpose",
          startedAt: ago(0.7),
          finishedAt: null,
          toolCount: 2,
          done: false,
          worktree: null,
          currentAction: "Edit tests/webhook.rs",
        },
      ],
      lines: [
        line("> Add retry with backoff to the billing webhook", "user"),
        line("I'll wrap sendWebhook in a retry helper and test the failure path."),
        line("* Edit src/webhook/send.rs", "tool"),
        line("* Bash cargo test -p billing", "tool"),
      ],
    }),
  },
  {
    id: "s-retry",
    label: "retry-after-header",
    ws: BILLING,
    diff: [9, 204, 37],
    live: live({
      sessionUuid: uuid(5),
      state: "running",
      startedAt: ago(48),
      model: "claude-opus-4-1",
      gitBranch: "atlas/retry-after-header",
      toolCalls: 312,
      contextTokens: 128_000,
      contextPct: 0.64,
      lastTool: "Edit",
      pendingTool: { name: "Edit", inputSummary: "src/retry.rs" },
      prUrl: "https://github.com/octo/atlas/pull/482",
      subagents: [
        ["Fix retry_after_header parsing", 7.5, 14],
        ["Find where retries are counted", 1.8, 9],
        ["Update the retry docs", 1, 3],
        ["Check the metrics names", 0.5, 2],
      ].map(([task, min, n]) => ({
        task: task as string,
        agentType: "general-purpose",
        startedAt: ago(min as number),
        finishedAt: null,
        toolCount: n as number,
        done: false,
        worktree: "atlas-wt-2",
        currentAction: null,
      })),
      lines: [
        line("> Parse Retry-After as an HTTP date too", "user"),
        line("* Grep retry_count crates/metrics", "tool"),
        line("* Read src/webhook/headers.rs", "tool"),
        line("* Edit src/retry.rs", "tool"),
      ],
    }),
  },
  {
    id: "s-metrics",
    label: "metrics-dashboard",
    ws: ATLAS,
    diff: null,
    live: live({ sessionUuid: uuid(6), state: "idle", startedAt: ago(120), lastActivity: null }),
  },
];

/** The session the Session screen focuses: running, with a plan, an agent and a ticket. */
export const FOCUSED = "s-billing";

export function seedWorld(view: "sessions" | "session" | "files" | "prs" | "stats" = "sessions") {
  const ws: Workspace[] = [
    { path: ATLAS, name: "atlas", color: WORKSPACE_COLORS[1], sessions: [] },
    { path: BILLING, name: "billing", color: WORKSPACE_COLORS[3], sessions: [] },
  ];
  const diffs = new Map();
  for (const s of SEEDS) {
    ws.find((w) => w.path === s.ws)!.sessions.push({
      id: s.id,
      label: s.label,
      status: "running",
      terminalTabId: `tab-${s.id}`,
      createdAt: s.live.startedAt!,
      claudeSessionId: s.live.sessionUuid,
      harnessId: "claude-code",
      ...(s.ticket && { ticket: { connectorId: "linear", id: ticket.id } }),
    });
    if (s.diff) {
      diffs.set(`tab-${s.id}`, {
        filesChanged: s.diff[0],
        linesAdded: s.diff[1],
        linesRemoved: s.diff[2],
      });
    }
    upsertLiveSession(s.live);
  }
  workspaces.set(ws);
  activeWorkspacePath.set(ATLAS);
  sessionDiffStats.set(diffs);
  tabs.set(
    SEEDS.map((s) => ({
      type: "terminal" as const,
      id: `tab-${s.id}`,
      ptyId: SEEDS.indexOf(s) + 1,
      cwd: s.ws,
      ready: true,
      needsInput: !!s.needs,
      needsInputKind: s.needs,
      harnessLabel: "Claude Code",
    })),
  );
  permissionPromptTabs.set(new Set(SEEDS.filter((s) => s.needs === "permission_prompt").map((s) => `tab-${s.id}`)));
  connectors.set([githubLinked, linearLinked]);
  tickets.set({
    [FOCUSED]: {
      link: { connectorId: "linear", id: ticket.id },
      state: { kind: "ready", ticket },
      last: ticket,
    },
  });
  focusedSessionId.set(FOCUSED);
  if (view === "files") {
    activeWorkspacePath.set(BILLING);
    fileWs.set(BILLING);
    openFiles.set(OPEN_FILES);
    activeFile.set(OPEN_FILES[0]!);
  }
  activeView.set(view);
}

export const DIFF = `diff --git a/src/webhook/send.rs b/src/webhook/send.rs
index 3b1c2d4..9f8e7a6 100644
--- a/src/webhook/send.rs
+++ b/src/webhook/send.rs
@@ -12,9 +12,22 @@ use crate::retry::{backoff, RetryPolicy};
 pub async fn send_webhook(client: &Client, hook: &Webhook) -> Result<()> {
-    let res = client.post(&hook.url).json(&hook.body).send().await?;
-    res.error_for_status()?;
-    Ok(())
+    let policy = RetryPolicy::default();
+    backoff(&policy, || async {
+        let res = client.post(&hook.url).json(&hook.body).send().await?;
+        if res.status().as_u16() == 429 {
+            return Err(Error::RateLimited(retry_after(&res)));
+        }
+        res.error_for_status()?;
+        Ok(())
+    })
+    .await
 }
diff --git a/src/retry.rs b/src/retry.rs
new file mode 100644
index 0000000..1a2b3c4
--- /dev/null
+++ b/src/retry.rs
@@ -0,0 +1,14 @@
+use std::time::Duration;
+
+pub struct RetryPolicy {
+    pub attempts: u32,
+    pub base: Duration,
+}
+
+impl Default for RetryPolicy {
+    fn default() -> Self {
+        Self { attempts: 5, base: Duration::from_millis(200) }
+    }
+}
+
+pub async fn backoff<F, Fut, T>(policy: &RetryPolicy, f: F) -> Result<T> { todo!() }
diff --git a/tests/webhook.rs b/tests/webhook.rs
index 4d5e6f7..8a9b0c1 100644
--- a/tests/webhook.rs
+++ b/tests/webhook.rs
@@ -40,6 +40,12 @@ async fn delivers_once() {
     assert_eq!(server.hits(), 1);
 }
+
+#[tokio::test]
+async fn retries_on_503() {
+    let server = MockServer::failing(2).await;
+    send_webhook(&client(), &hook(&server)).await.unwrap();
+    assert_eq!(server.hits(), 3);
+}
`;

export const panel = (cwd: string): PanelData => ({
  version: 1,
  timestamp: new Date().toISOString(),
  cwd,
  diff: {
    raw: DIFF,
    files_changed: 3,
    lines_added: 86,
    lines_removed: 12,
    fingerprint: "fp-1",
  },
});

const TRANSCRIPT = [
  "\x1b[2m> \x1b[0mAdd retry with backoff to the billing webhook",
  "\x1b[32m●\x1b[0m I'll wrap sendWebhook in a retry helper and test the failure path",
  "  Edit src/webhook/send.rs · +38 −4",
  "  Bash cargo test -p billing",
  "running 46 tests",
  "test webhook::retries_on_503 ... ok",
  "\x1b[33mtest webhook::retry_after_header ... running\x1b[0m",
  "",
].join("\r\n");

const PERMISSION_SCREEN = [
  "╭──────────────────────────────────────────╮",
  "│ Bash command                             │",
  "│   pnpm vitest run overview               │",
  "│ Do you want to proceed?                  │",
  "│ ❯ 1. Yes                                 │",
  "│   2. Yes, and don't ask again            │",
  "│   3. No, and tell Claude what to do      │",
  "╰──────────────────────────────────────────╯",
  "",
].join("\r\n");

// Full codeburn rows for the six sessions (the cost store keys them by id), then the fixture's.
const codeburnSessions = [
  ...SEEDS.map((s, i) => ({
    ...sessionsJson[0]!,
    sessionId: s.live.sessionUuid,
    title: s.label,
    project: s.ws === ATLAS ? "atlas" : "billing",
    cost: [1.37, 0.31, 0.96, 0.84, 4.18, 0][i]!,
  })),
  ...sessionsJson,
];

const byPr = {
  prs: [
    { url: "https://github.com/octo/billing/pull/482", label: "octo/billing#482", cost: 6.12, sessions: 3, state: null },
    { url: "https://github.com/octo/atlas/pull/503", label: "octo/atlas#503", cost: 2.4, sessions: 2, state: "merged" },
    { url: "https://github.com/octo/billing/pull/497", label: "octo/billing#497", cost: 0.84, sessions: 1, state: null },
  ],
  distinct: { cost: 18.06, sessions: 6, attributedCost: 9.36, unattributedCost: 8.7 },
};

const branches = {
  period: { label: "Last 30 days" },
  projects: [
    {
      id: "billing",
      label: "billing",
      totalCost: 46.2,
      branches: [
        { branch: "atlas/billing-retry", cost: 12.4, calls: 310, sessions: 6 },
        { branch: "feat/retry-after", cost: 9.1, calls: 220, sessions: 4 },
        { branch: "main", cost: 24.7, calls: 640, sessions: 11 },
      ],
    },
    {
      id: "atlas",
      label: "atlas",
      totalCost: 96.3,
      branches: [
        { branch: "atlas/pinned-tiles", cost: 31.2, calls: 700, sessions: 9 },
        { branch: "main", cost: 65.1, calls: 1500, sessions: 30 },
      ],
    },
  ],
};

/** `compare --format cohort-json --model-a A --model-b B`: the same tasks, side by side. */
function cohort(argv: string[]) {
  const side = (model: string, scale: number, oneShot: number) => {
    const observations = ["Coding", "Debugging", "Exploration", "Coding", "Testing", "Coding"].map((category, i) => ({
      project: i % 2 ? "atlas" : "billing",
      category,
      costUSD: +(scale * (0.4 + i * 0.3)).toFixed(3),
      costKnown: true,
      oneShot: i % 3 !== 0 || oneShot > 0.7,
    }));
    return {
      model,
      label: model,
      stats: { model, label: model, observationCount: observations.length, retryRate: 0.08 / scale, oneShotRate: oneShot * 100, costMedian: scale * 1.1, costP90: scale * 2.2, costMean: scale * 1.2 },
      observations,
    };
  };
  const a = argv[argv.indexOf("--model-a") + 1] ?? "A";
  const b = argv[argv.indexOf("--model-b") + 1] ?? "B";
  return { kind: "cohort-comparison", modelA: side(a, 2.5, 0.74), modelB: side(b, 1, 0.58) };
}

/** Answer a codeburn argv from the fixtures, by subcommand and format. */
function codeburnRun({ args }: Record<string, unknown>): unknown {
  const argv = args as string[];
  const [cmd] = argv;
  const fmt = argv[argv.indexOf("--format") + 1];
  switch (cmd) {
    case "status":
      return fmt === "menubar-json" ? overview() : status;
    case "sessions":
      if (argv.includes("--by-pr")) return byPr;
      return codeburnSessions;
    case "report":
      return report;
    case "models":
      return models;
    case "compare":
      return fmt === "cohort-json" ? cohort(argv) : compare;
    case "compare-periods":
      return comparePeriods;
    case "optimize":
      return optimize;
    case "quota":
      return quota;
    case "spend":
      return fmt === "branch-json" ? branches : spend;
    case "yield":
      return yieldJson;
    case "plan":
      return plan;
  }
  throw { kind: "unknown", message: `no fixture for codeburn ${argv.join(" ")}` };
}

function overview() {
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000);
    return { date: d.toISOString().slice(0, 10), cost: +(2 + 3 * Math.abs(Math.sin(i))).toFixed(2), calls: 40 + i };
  });
  return {
    generated: new Date().toISOString(),
    current: {
      label: "All time",
      cost: 142.5,
      calls: 4_210,
      sessions: 96,
      sessionCountBasis: "exact",
      oneShotRate: 0.62,
      inputTokens: 12_400_000,
      outputTokens: 1_900_000,
      cacheReadTokens: 88_000_000,
      cacheWriteTokens: 6_100_000,
      cacheHitPercent: 91,
      topActivities: [
        { name: "Coding", cost: 71.2, turns: 820, oneShotRate: 0.58 },
        { name: "Debugging", cost: 33.4, turns: 310, oneShotRate: 0.44 },
        { name: "Exploration", cost: 21.9, turns: 400, oneShotRate: 0.8 },
      ],
      topModels: [
        { name: "Sonnet 4.5", cost: 88.1, calls: 3_100 },
        { name: "Opus 4.1", cost: 49.9, calls: 610 },
        { name: "Haiku 4.5", cost: 4.5, calls: 500 },
      ],
      topProjects: [
        { id: "atlas", name: "atlas", cost: 96.3, sessions: 61 },
        { id: "billing", name: "billing", cost: 46.2, sessions: 35 },
      ],
      byBranch: [
        { branch: "main", cost: 40.1, sessions: 30 },
        { branch: "atlas/billing-retry", cost: 12.4, sessions: 6 },
      ],
      tools: [
        { name: "Edit", calls: 1_200 },
        { name: "Bash", calls: 980 },
        { name: "Read", calls: 870 },
      ],
    },
    history: { daily: days },
    streak: 12,
  };
}

// ── Files ────────────────────────────────────────────────────────────────
const PLANS_DIR = "/Users/dev/.claude/plans";
const planName = (ws: string, name: string) => `${slugifyPath(ws)}-${name}`;
export const PLAN_PATH = `${PLANS_DIR}/${planName(BILLING, "retry-plan.md")}`;
const plans: PlanEntry[] = [
  { path: PLAN_PATH, name: planName(BILLING, "retry-plan.md"), modified: ago(3) },
  {
    path: `${PLANS_DIR}/${planName(BILLING, "pinned-tiles.md")}`,
    name: planName(BILLING, "pinned-tiles.md"),
    modified: ago(60),
  },
];
const docs: DocEntry[] = [
  { rel_path: "docs", name: "docs", is_dir: true, size: 0, modified: null },
  { rel_path: "docs/webhooks.md", name: "webhooks.md", is_dir: false, size: 2048, modified: ago(90) },
  { rel_path: "docs/retries.md", name: "retries.md", is_dir: false, size: 1024, modified: ago(30) },
];
export const FILE_TEXT: Record<string, string> = {
  [PLAN_PATH]: `# Retry with backoff

1. Find the webhook sender
2. Add a retry helper with backoff
3. Wrap sendWebhook in the helper
4. Test the failure path
5. Honor Retry-After
6. Open the pull request

See [[webhooks]] for the delivery contract.
`,
  [`${BILLING}/src/retry.rs`]: `use std::time::Duration;

pub struct RetryPolicy {
    pub attempts: u32,
    pub base: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self { attempts: 5, base: Duration::from_millis(200) }
    }
}
`,
};
/** The design's two open tabs: a plan and a source file. */
export const OPEN_FILES = [fileKey("plans", PLAN_PATH), fileKey(BILLING, "src/retry.rs")];

/** Open PRs per watched repo, covering every row state the PR screen draws. */
export const PRS: Record<string, PullRequest[]> = {
  "octo/atlas": [
    pull({
      number: 503,
      title: "Sort pinned tiles first on the overview",
      headRefName: "atlas/pinned-tiles",
      author: "hubot",
      review: { kind: "approved" },
      reviewRequestLogins: [],
    }),
    pull({
      number: 498,
      title: "Rewrite the Settings copy for connectors",
      headRefName: "docs/connectors",
      checks: checks.running,
      review: { kind: "changes" },
    }),
    pull({
      number: 491,
      title: "Fix the flaky overview test",
      headRefName: "atlas/overview-sort",
      author: "mona",
      reviewRequestLogins: ["octo"],
      updatedAt: "2026-11-21T16:00:00Z",
    }),
  ],
  "octo/billing": [
    pull({ checks: checks.failing, review: { kind: "comments", count: 3 }, commentsCount: 3 }),
    pull({
      number: 497,
      title: "Retry failed webhook deliveries with backoff",
      headRefName: "atlas/billing-retry",
      state: "draft",
      checks: checks.running,
    }),
  ],
};

export const worldBackend: Backend = {
  list_claude_plans: plans,
  list_workspace_docs: ({ workspacePath }) => ({
    entries: workspacePath === BILLING ? docs : [],
    truncated: false,
  }),
  list_dir: { entries: [], truncated: false },
  read_text_file_at: ({ path }) => ({
    contents: FILE_TEXT[path as string] ?? "# Notes\n",
    mtime: Date.now() - 60_000,
  }),
  start_docs_watch: null,
  stop_docs_watch: null,
  files_grant: null,
  state_load: ({ name }) => ({
    contents: name === "settings" ? JSON.stringify({ version: 1, firstRunDismissed: true, watchedRepos: Object.keys(PRS) }) : null,
    recovered: false,
  }),
  connector_list: [githubLinked, linearLinked],
  connector_get_ticket: ticket,
  list_workspace_repos: ({ workspacePath }) =>
    [
      { path: ATLAS, slug: "octo/atlas" },
      { path: BILLING, slug: "octo/billing" },
    ].filter((r) => r.path === workspacePath),
  connector_list_pull_requests: ({ repos }) =>
    (repos as { slug: string }[]).flatMap((r) => PRS[r.slug] ?? []),
  get_panel_data: ({ sessionId }) => (sessionId === `tab-${FOCUSED}` ? panel(BILLING) : null),
  refresh_panel: ({ cwd }) => panel(cwd as string),
  get_git_status: { has_unstaged: true, has_staged: false },
  pty_spawn: ({ onData, envVars }) => {
    const ch = onData as { onmessage: (m: ArrayBuffer) => void };
    const tab = (envVars as Record<string, string> | null)?.ATLAS_SESSION_ID;
    // The tile's Allow/Deny only shows while the screen really shows the prompt.
    const screen = tab === "tab-s-pinned" ? PERMISSION_SCREEN : TRANSCRIPT;
    setTimeout(() => ch.onmessage(new TextEncoder().encode(screen).buffer as ArrayBuffer), 50);
    return SEEDS.findIndex((s) => `tab-${s.id}` === tab) + 1;
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  start_session_tail: null,
  stop_session_tail: null,
  claude_check: "2.1.0",
  claude_info: {
    binary: "/usr/local/bin/claude",
    version: "2.1.0",
    notificationHookInstalled: true,
    sessionStartHookInstalled: true,
    notificationHook: { kind: "installed", upToDate: true },
    sessionStartHook: { kind: "installed", upToDate: true },
  },
  codeburn_info: { binary: "/usr/local/bin/codeburn", version: "0.9.27" },
  codeburn_run: codeburnRun,
  list_resumable_sessions: [],
};

/** A seeded session's overview tile, as SessionView and the rail receive it. Call after `seedWorld`. */
export function tileOf(id: string): SessionTile | null {
  return get(liveTiles).find((t) => t.atlasSessionId === id) ?? null;
}
