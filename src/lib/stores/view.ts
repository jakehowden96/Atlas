import { writable } from "svelte/store";

/** Mission Control's four top-level screens. */
export type View = "overview" | "session" | "prs" | "stats";

export const activeView = writable<View>("overview");

/** Atlas session id shown in Session view. */
export const focusedSessionId = writable<string>("");

/** Session view's right-hand Changes drawer. */
export const diffOpen = writable(false);

/** Session view's activity rail. Open by default. */
export const railOpen = writable(true);

export const newSessionOpen = writable(false);

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
