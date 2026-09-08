import { writable } from "svelte/store";

/** Mission Control's top-level screens. */
export type View = "overview" | "files" | "session" | "prs" | "stats";

/** The tabs in the top bar, in ⌘1–4 order. "session" is not one of them — it
    is a detail view Overview opens in place. */
export const TAB_VIEWS = ["overview", "files", "prs", "stats"] as const;

export const activeView = writable<View>("overview");

/** Atlas session id shown in Session view. */
export const focusedSessionId = writable<string>("");

/** Session view's right-hand Changes drawer. */
export const diffOpen = writable(false);

/** Session view's activity rail. Open by default. */
export const railOpen = writable(true);

export const newSessionOpen = writable(false);

/**
 * What the New Session modal should be showing when it opens. Set by callers
 * that already know the answer — the Stats screen's Recent-sessions rows open
 * straight into Resume with that conversation picked. Null is a plain ⌘N.
 */
export interface NewSessionSeed {
  /** Matched against workspace paths by folded form, not raw string. */
  workspacePath?: string;
  /** Present means open in Resume mode with this conversation selected. */
  resumeSessionId?: string;
  /** A file the session should start with in mind — the Files editor's "Ask
   *  Claude". The modal shows it as context; nothing is attached for real. */
  attachPath?: string;
}

export const newSessionSeed = writable<NewSessionSeed | null>(null);

/** Open the New Session modal, optionally pre-aimed at a workspace or session. */
export function openNewSession(seed?: NewSessionSeed): void {
  newSessionSeed.set(seed ?? null);
  newSessionOpen.set(true);
}

/** The ⌘K jump-to-session palette. */
export const jumpOpen = writable(false);

/** Overview's workspace chip filter: "all" or a workspace path. */
export const wsFilter = writable<string>("all");

/**
 * Switch views. The Changes drawer belongs to Session view, so leaving Session
 * closes it — otherwise it would reappear on the next visit.
 */
export function showView(v: View): void {
  if (v !== "session") diffOpen.set(false);
  activeView.set(v);
}
