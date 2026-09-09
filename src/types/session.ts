/** Mirrors `src-tauri/src/session/live.rs`. */

export type SessionState = "running" | "needsYou" | "idle" | "error";

/**
 * Terminal line colours: `user`/`note` use `--t-user`, `step`/`working` use
 * `--t-step`, `tool` uses `--t-tool`, `alert` uses `--t-warn`.
 */
export type LineRole = "user" | "step" | "tool" | "note" | "working" | "alert";

export interface TranscriptLine {
  role: LineRole;
  text: string;
  timestamp: string | null;
}

export interface PlanItem {
  text: string;
  /** `pending` | `in_progress` | `completed`, straight from `TodoWrite`. */
  status: string;
}

export interface Subagent {
  task: string;
  startedAt: string | null;
  /** When it stopped. Null while it is still running, and when the line that
   *  ended it carried no timestamp — `done` is the flag. */
  finishedAt: string | null;
  toolCount: number;
  done: boolean;
}

export interface PendingTool {
  name: string;
  inputSummary: string;
}

export interface LiveSession {
  sessionUuid: string;
  state: SessionState;
  startedAt: string | null;
  lastActivity: string | null;
  title: string | null;
  model: string | null;
  gitBranch: string | null;
  /** Newest 200 transcript lines, oldest first. */
  lines: TranscriptLine[];
  plan: PlanItem[];
  subagents: Subagent[];
  toolCalls: number;
  lastTool: string | null;
  pendingTool: PendingTool | null;
  outputTokens: number;
  costEstimate: number;
  peakContext: number;
  /** Fraction 0–1 of the model's context window. Approximate. */
  contextPct: number;
}

export interface SessionUpdateEvent {
  session_uuid: string;
  session: LiveSession;
}
