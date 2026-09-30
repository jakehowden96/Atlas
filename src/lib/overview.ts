/**
 * Pure helpers behind the Overview grid.
 *
 * The join, the sort and the filter live here rather than in the components so
 * they can be unit-tested without a Svelte compiler (README → Conventions).
 */
import type { LiveSession, PlanItem, SessionState, TranscriptLine } from "../types/session";
import type { OverviewOrdering } from "./stores/settings";
import type { View } from "./stores/view";
import type { DiffStats, Workspace, WorkspaceSession } from "./stores/workspace";

/** Design default ordering: needs-you first, then running/error, then idle. */
const ATTENTION_RANK: Record<SessionState, number> = {
  needsYou: 0,
  running: 1,
  error: 1,
  idle: 2,
};

export interface SessionTile {
  /** Claude session UUID — the `liveSessions` key and the tile's identity. */
  sessionUuid: string;
  /** Atlas session row id; `""` when no workspace row owns this UUID. */
  atlasSessionId: string;
  /** Terminal tab id — the PTY that answers permission prompts. */
  terminalTabId: string | null;
  workspacePath: string;
  workspaceName: string;
  workspaceColour: string;
  label: string;
  branch: string;
  /** `live.state` with the Notification hook's needs-input flag folded in. */
  state: SessionState;
  live: LiveSession;
  diff: DiffStats | null;
  /** When the session was created — the row's, or the live session's own for
   *  a tile no workspace row owns. What `"opened"` ordering sorts by. */
  createdAt: string;
}

/**
 * Join every tailed session to the workspace row that owns it.
 *
 * Two different keys meet here: `LiveSession` is keyed by the Claude UUID,
 * while `sessionDiffStats` is keyed by `terminalTabId`. `WorkspaceSession`
 * carries both, so it is the only correct bridge — matching on anything else
 * silently shows another session's diff numbers.
 *
 * `needsInputTabs` are the terminal tabs the Notification hook has flagged
 * (`TabItem.needsInput`). Claude Code's tail never sets `needsYou` itself —
 * the transcript cannot see a permission prompt — so that flag is its only
 * signal. OMP's tail does, while its `ask` tool waits on an answer.
 *
 * Folding it in needs a terminal tab id, which only the workspace row carries,
 * so the second loop's rowless tiles can never read needs-you. That costs
 * nothing: the flag is set from `ATLAS_SESSION_ID`, which only a PTY Atlas
 * spawned carries, and every such PTY has a row (`spawnHarnessSession` writes
 * one before it calls `addTab`). A session with no row is one Atlas never
 * started, so no notification for it can exist.
 *
 * An idle transcript whose last reply ends on a question is also needs-you,
 * since Claude is waiting on an answer the hook never reports.
 */
export function buildTiles(
  sessions: LiveSession[],
  workspaceList: Workspace[],
  diffStats: Map<string, DiffStats>,
  needsInputTabs: ReadonlySet<string>,
): SessionTile[] {
  const liveByUuid = new Map(sessions.map((s) => [s.sessionUuid, s]));
  const claimed = new Set<string>();
  const tiles: SessionTile[] = [];

  // Every open Atlas session gets a tile whether or not its transcript has
  // appeared. The tail needs the file to exist before it can report anything,
  // and transcript saving can be off entirely — neither should make a running
  // session invisible on the Overview.
  for (const workspace of workspaceList) {
    for (const row of workspace.sessions) {
      // Claimed whether or not the row is currently open: a UUID a row owns
      // must never fall through to the orphan loop below, or closing a
      // session while its transcript is still catching up resurrects it as
      // a tile the moment the trailing live-session update lands.
      if (row.claudeSessionId) claimed.add(row.claudeSessionId);
      if (row.terminalTabId === null) continue; // persisted, not currently open
      const live =
        (row.claudeSessionId ? liveByUuid.get(row.claudeSessionId) : undefined) ??
        pendingLive(row);
      tiles.push(toTile(live, workspace, row, diffStats, needsInputTabs));
    }
  }

  // A tailed session no workspace row owns still deserves a tile.
  for (const live of sessions) {
    if (claimed.has(live.sessionUuid)) continue;
    tiles.push(toTile(live, undefined, undefined, diffStats, needsInputTabs));
  }

  return tiles;
}

/** Stand-in for a spawned session whose transcript has not arrived yet. */
function pendingLive(row: WorkspaceSession): LiveSession {
  const state: SessionState =
    row.status === "error"
      ? "error"
      : row.status === "running" || row.status === "starting"
        ? "running"
        : "idle";
  return {
    sessionUuid: row.claudeSessionId ?? row.id,
    state,
    startedAt: row.createdAt,
    lastActivity: null,
    title: row.label,
    model: null,
    gitBranch: null,
    lines: [],
    plan: [],
    subagents: [],
    toolCalls: 0,
    lastTool: null,
    pendingTool: null,
    outputTokens: 0,
    costEstimate: 0,
    contextTokens: 0,
    peakContext: 0,
    contextPct: 0,
    lastPrompt: null,
    lastReply: null,
    turnEndedAt: null,
    turnDurationMs: null,
  };
}

function toTile(
  live: LiveSession,
  workspace: Workspace | undefined,
  row: WorkspaceSession | undefined,
  diffStats: Map<string, DiffStats>,
  needsInputTabs: ReadonlySet<string>,
): SessionTile {
  const tabId = row?.terminalTabId ?? null;
  const flagged = tabId !== null && needsInputTabs.has(tabId);
  const asking = openQuestion(live) !== null;
  return {
    sessionUuid: live.sessionUuid,
    atlasSessionId: row?.id ?? "",
    terminalTabId: tabId,
    workspacePath: workspace?.path ?? "",
    workspaceName: workspace?.name ?? "",
    workspaceColour: workspace?.color ?? "var(--surface3)",
    label: live.title ?? row?.label ?? "Session",
    branch: live.gitBranch ?? "",
    state: flagged || asking ? "needsYou" : live.state,
    live,
    diff: tabId === null ? null : (diffStats.get(tabId) ?? null),
    createdAt: row?.createdAt ?? live.startedAt ?? "",
  };
}

/**
 * Whether an `activeTabId` change means the user has actually attended to that
 * session, so the Notification hook's needs-input flag can be dropped.
 *
 * The old rule was "it is the active tab", and being the active tab is not the
 * same as having been seen. `activeTabId` is written by `addTab` on every
 * spawn, by `removeTab`'s fallback when a *neighbouring* tab is closed, by
 * `openSession` and by `SessionView`'s own reconciliation effect — which keeps
 * running because `App` keeps `SessionView` mounted behind every other screen
 * so its xterm instances survive a view switch. Any of those fires while the
 * user is on Sessions, Files, PRs or Stats and clears the flag off a session
 * nobody has looked at, which drops its tile back to `running` while it is
 * still blocked at its prompt.
 *
 * The terminal is only on screen on the Session view, so that is the only
 * moment the prompt can be said to have been seen.
 */
export function shouldClearNeedsInput(view: View, activeTabId: string): boolean {
  return view === "session" && activeTabId !== "";
}

/** Attention order. `Array.sort` is stable, so ties keep their arrival order. */
export function compareByAttention(
  a: { state: SessionState },
  b: { state: SessionState },
): number {
  return ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state];
}

/** Workspace order: grouped by workspace name, then by label inside each. */
export function compareByWorkspace(
  a: { workspaceName: string; label: string },
  b: { workspaceName: string; label: string },
): number {
  return (
    a.workspaceName.localeCompare(b.workspaceName) || a.label.localeCompare(b.label)
  );
}

/** Opened order: strictly by session creation time, so the grid never
 *  re-sorts on a status change. The default — see `overviewOrdering`. */
export function compareByOpened(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * The comparator behind Settings › General › Overview ordering. "manual" has
 * no comparator: the grid keeps the order sessions arrived in.
 */
function orderingComparator(
  ordering: OverviewOrdering,
): ((a: SessionTile, b: SessionTile) => number) | null {
  switch (ordering) {
    case "workspace":
      return compareByWorkspace;
    case "manual":
      return null;
    case "opened":
      return compareByOpened;
    default:
      return compareByAttention;
  }
}

/**
 * The identity a pin is stored under.
 *
 * The Atlas row id whenever a workspace owns the session: it survives the
 * transcript being adopted — which swaps the tile's `sessionUuid` from the row
 * id to the real Claude UUID — and survives a later resume. A tailed session
 * no workspace row owns has no id to use, so it pins by transcript UUID.
 */
export function pinKey(tile: SessionTile): string {
  return tile.atlasSessionId || tile.sessionUuid;
}

/**
 * The ordering above, with pinned tiles lifted to the top of it.
 *
 * Pinning does not replace the ordering, it only splits the grid in two: the
 * pinned tiles sort among themselves exactly as the unpinned ones do. "manual"
 * still has no ordering of its own — `Array.sort` is stable, so a comparator
 * that returns 0 for two same-pinnedness tiles leaves them in arrival order.
 * With nothing pinned the ordering's own comparator is handed back untouched,
 * so the "manual" grid does not get sorted at all.
 */
export function tileComparator(
  ordering: OverviewOrdering,
  pinned: ReadonlySet<string> = new Set(),
): ((a: SessionTile, b: SessionTile) => number) | null {
  const within = orderingComparator(ordering);
  if (pinned.size === 0) return within;
  const rank = (t: SessionTile) => (pinned.has(pinKey(t)) ? 0 : 1);
  return (a, b) => rank(a) - rank(b) || (within ? within(a, b) : 0);
}

/** `"all"` keeps everything; any other value matches on workspace path. */
export function filterByWorkspace<T extends { workspacePath: string }>(
  tiles: T[],
  filter: string,
): T[] {
  return filter === "all" ? tiles : tiles.filter((t) => t.workspacePath === filter);
}

/**
 * Fixed-width plan bar: `count` segments filled in proportion to completed
 * todos, so the bar stays 140px whatever the plan's length.
 */
export function planSegments(plan: PlanItem[], count = 6): boolean[] {
  const done = plan.filter((p) => p.status === "completed").length;
  const filled = plan.length === 0 ? 0 : Math.round((done / plan.length) * count);
  return Array.from({ length: count }, (_, i) => i < filled);
}

/** `2m 14s` under an hour, `1h 04m` above it. Empty when the start is unknown. */
export function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return "";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (secs >= 3600) {
    const mins = Math.floor((secs % 3600) / 60);
    return `${Math.floor(secs / 3600)}h ${String(mins).padStart(2, "0")}m`;
  }
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

// ── Session card ──────────────────────────────────────────────────────────────

/** A tool name for the card, shortened for an MCP tool: `Linear · list_issues`
 *  rather than `mcp__claude_ai_Linear__list_issues`. `null` reads as "—". */
export function shortToolName(name: string | null): string {
  if (name === null) return "—";
  const match = name.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return name;
  const server = match[1].replace(/^claude_ai_/, "");
  return `${server} · ${match[2]}`;
}

/**
 * Splits a reply's closing question off from the rest, so the card can show
 * the question as its own callout. A paragraph ending in `?` — allowing for
 * trailing markdown or quote punctuation — is the question; everything above
 * it is the body.
 */
export function splitReply(reply: string | null): { body: string; question: string | null } {
  if (!reply) return { body: "", question: null };
  const paragraphs = reply
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (paragraphs.length === 0) return { body: "", question: null };
  const last = paragraphs[paragraphs.length - 1];
  if (/\?[\s*_`)"'”’]*$/.test(last)) {
    return { body: paragraphs.slice(0, -1).join("\n\n"), question: last };
  }
  return { body: paragraphs.join("\n\n"), question: null };
}

/**
 * The question the session is still waiting on: an OMP `ask` it is blocked
 * on — the only `needsYou` the backend reports — or an idle session's closing
 * question. Once it is running again the question has been answered, or the
 * session moved past it, and lifting it into the callout would pin a stale ask.
 */
export function openQuestion(live: LiveSession): string | null {
  if (live.state === "needsYou") return live.pendingTool?.inputSummary || null;
  return live.state === "idle" ? splitReply(live.lastReply).question : null;
}

/** Strips the markdown emphasis/code markers a plain-text card should not show. */
export function plainText(s: string): string {
  return s.replace(/\*\*|__|`/g, "");
}

/** `55s` under a minute, `1m 17s` under an hour, `1h 04m` above it. */
export function formatWorked(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }
  const mins = Math.floor((secs % 3600) / 60);
  return `${Math.floor(secs / 3600)}h ${String(mins).padStart(2, "0")}m`;
}

/** A turn's end time as the card shows it, e.g. `11:04`. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * What a card's activity line says: the tool a running session is waiting on,
 * the background agents it is waiting on, or when an idle one last finished
 * and how long that turn took. `null` for every other state, which the card
 * handles separately.
 */
export function activity(
  live: LiveSession,
  clock: (iso: string) => string = formatClock,
): { running: boolean; text: string } | null {
  if (live.state === "running") {
    const pending = live.pendingTool;
    if (!pending) {
      const agents = live.subagents.filter((a) => !a.done).length;
      if (agents === 0) return { running: true, text: "Working…" };
      return { running: true, text: `Waiting on ${agents} agent${agents === 1 ? "" : "s"}` };
    }
    const label = shortToolName(pending.name);
    return {
      running: true,
      text: pending.inputSummary ? `${label} · ${pending.inputSummary}` : label,
    };
  }
  if (live.state === "idle") {
    const ended = live.turnEndedAt ?? live.lastActivity;
    if (!ended) return null;
    const worked =
      live.turnEndedAt && live.turnDurationMs != null
        ? ` · worked ${formatWorked(live.turnDurationMs)}`
        : "";
    return { running: false, text: `Finished ${clock(ended)}${worked}` };
  }
  return null;
}

/** One row of a card's conversation feed. */
export interface FeedItem {
  kind: "you" | "note" | "step" | "alert";
  text: string;
  /** The tool a `step` ran, shortened as `shortToolName` does. */
  tool: string | null;
}

/**
 * The conversation as a card shows it: prompts, Claude's prose and the tools
 * it called, oldest first. A successful tool result is dropped — the call
 * already says what was done — but a failed one stays, as an alert. There is
 * no row cap: the card clips the oldest rows by the room it actually has.
 *
 * `question` is the reply's closing question when the card lifts it into its
 * own callout; it is cut off the newest note so it is not shown twice.
 *
 * Roles come off the line's text prefix rather than `role`, because the live
 * tail dresses its newest line as `working` and hides the real role.
 */
export function feedItems(
  lines: readonly TranscriptLine[],
  question: string | null = null,
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const line of lines) {
    const { text } = line;
    if (text.startsWith("> ")) {
      items.push({ kind: "you", text: plainText(text.slice(2)), tool: null });
    } else if (text.startsWith("* ")) {
      const body = text.slice(2);
      const gap = body.indexOf(" ");
      const name = gap === -1 ? body : body.slice(0, gap);
      const summary = gap === -1 ? "" : body.slice(gap + 1);
      items.push({ kind: "step", text: summary, tool: shortToolName(name) });
    } else if (text.startsWith("  ")) {
      if (line.role === "alert") items.push({ kind: "alert", text: text.trim(), tool: null });
    } else if (text.trim() !== "") {
      items.push({ kind: "note", text: plainText(text), tool: null });
    }
  }

  const last = items[items.length - 1];
  if (question && last?.kind === "note") {
    const q = plainText(question).split(/\s+/).join(" ");
    if (last.text.endsWith(q)) {
      last.text = last.text.slice(0, -q.length).trim();
      if (last.text === "") items.pop();
    }
  }
  return items;
}

// ── Grid keyboard model ───────────────────────────────────────────────────────

/** What the grid asks the view to do besides move focus between tiles. */
export type GridKeyEffect = "chips" | null;

export interface GridKeyResult {
  /** The tile that should hold focus once the key is applied. */
  index: number;
  effect: GridKeyEffect;
  /** False when the key was none of the grid's; the caller leaves it alone. */
  handled: boolean;
}

/**
 * Arrow/Home/End movement over the Sessions grid.
 *
 * `columns` is however many tracks `auto-fit` laid out at the current window
 * width — the view reads it back off the DOM, so the CSS is never re-derived
 * here. ←/→ step one tile in the sorted order, ↑/↓ step one row.
 *
 * Nothing wraps: ←/→ stop at the ends of their row rather than rolling onto the
 * next one, because a grid is not a list and both rows are on screen at once.
 * ↑ off the top row is the single exit — it hands focus back to the workspace
 * chips, which is where ↓ brought it in.
 *
 * Enter, Space and the permission keys need none of these three numbers, so
 * they stay on the tile itself.
 */
export function handleGridKey(
  e: { key: string },
  index: number,
  total: number,
  columns: number,
): GridKeyResult {
  if (total <= 0) return { index: 0, effect: null, handled: false };
  const at = Math.min(Math.max(0, index), total - 1);
  const cols = Math.max(1, columns);
  const stay: GridKeyResult = { index: at, effect: null, handled: true };
  const to = (next: number): GridKeyResult =>
    next >= 0 && next < total ? { index: next, effect: null, handled: true } : stay;

  switch (e.key) {
    case "ArrowLeft":
      return at % cols === 0 ? stay : to(at - 1);
    case "ArrowRight":
      return (at + 1) % cols === 0 ? stay : to(at + 1);
    case "ArrowUp":
      return at < cols ? { index: at, effect: "chips", handled: true } : to(at - cols);
    case "ArrowDown":
      return to(at + cols);
    case "Home":
      return to(0);
    case "End":
      return to(total - 1);
    default:
      return { index: at, effect: null, handled: false };
  }
}

/**
 * The rows of a terminal screen — the rows `TerminalSession` tints.
 *
 * `rows` is the xterm's visible buffer as `TerminalSession` published it. Two
 * things come off the bottom: blank rows, and Claude Code's prompt box. The
 * box is the TUI's own — a rule row, the `>` input, a rule row, then the
 * shortcuts/context status line — so a tile cannot leave it out by omitting a
 * component; it has to find it in the text. Two rule rows within a few rows
 * of each other at the bottom of the screen is that box, and everything from
 * the upper rule down goes. Anything else — a permission dialog, a TUI whose
 * layout this does not recognise — stays, so the tile degrades to showing the
 * screen as-is rather than eating rows it should not.
 */
const PROMPT_BOX_SEARCH_ROWS = 12;
const PROMPT_BOX_MAX_HEIGHT = 8;
const RULE_MIN_LENGTH = 8;
const RULE_CHARS = /^[─━═\-╭╮╰╯┌┐└┘]+$/;

function isRuleRow(row: string): boolean {
  const t = row.trim();
  return t.length >= RULE_MIN_LENGTH && RULE_CHARS.test(t);
}

function trimBlankTail(rows: readonly string[]): readonly string[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].trim() === "") end--;
  return rows.slice(0, end);
}

export function screenPreview(rows: readonly string[]): string[] {
  const trimmed = trimBlankTail(rows);
  const floor = Math.max(0, trimmed.length - PROMPT_BOX_SEARCH_ROWS);

  let lower = -1;
  for (let i = trimmed.length - 1; i >= floor; i--) {
    if (!isRuleRow(trimmed[i])) continue;
    if (lower === -1) {
      lower = i;
      continue;
    }
    if (lower - i <= PROMPT_BOX_MAX_HEIGHT) {
      return [...trimBlankTail(trimmed.slice(0, i))];
    }
    lower = i;
  }
  return [...trimmed];
}

/** The block a transcript row belongs to, for the row-tint feature. */
export type RowBlock = "user" | "tool" | "claude" | null;

const USER_ROW = /^>\s/;
const TOOL_ROW = /^\s*(?:⏺\s+[A-Za-z][A-Za-z0-9_-]*\(|⎿)/;

/**
 * Classifies every row of a screen (or `screenPreview` output) into the
 * block it belongs to, so the terminal pane can tint user input, tool calls
 * and Claude's own prose differently.
 *
 * `⏺` alone does not mean a tool call — Claude Code prefixes its own prose
 * with `⏺` too, so a tool row needs the marker followed by an identifier and
 * an opening paren (`⏺ Bash(…)`), or the `⎿` continuation glyph. A bare
 * `⏺ some prose` row classifies as `"claude"`.
 *
 * A non-blank row that starts with whitespace continues whatever block came
 * before it — wrapped `> ` input and `⎿` tool output are both indented by
 * the TUI — so indentation, not content, decides whether it carries the
 * block forward. Blank rows and rule rows are boundaries: they classify as
 * `null` and reset the carried block, so prose that follows a tool block is
 * `"claude"` rather than inheriting `"tool"`.
 */
export function classifyRows(rows: readonly string[]): RowBlock[] {
  const out: RowBlock[] = [];
  let carry: RowBlock = null;
  for (const row of rows) {
    if (row.trim() === "" || isRuleRow(row)) {
      out.push(null);
      carry = null;
    } else if (USER_ROW.test(row)) {
      carry = "user";
      out.push(carry);
    } else if (TOOL_ROW.test(row)) {
      carry = "tool";
      out.push(carry);
    } else if (/^\s/.test(row) && (carry === "user" || carry === "tool")) {
      out.push(carry);
    } else {
      carry = "claude";
      out.push(carry);
    }
  }
  return out;
}
