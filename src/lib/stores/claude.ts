import { get, writable } from "svelte/store";
import { claudeCheck, claudeInfo } from "../ipc";
import { claudeBinaryPath } from "./settings";

/** True once a `claude_check` has failed; cleared by the next one that passes. */
export const claudeMissing = writable(false);

/** Probe the saved override, or PATH when there is none. */
export async function recheckClaude(): Promise<void> {
  try {
    await claudeCheck(get(claudeBinaryPath) || null);
    claudeMissing.set(false);
  } catch {
    claudeMissing.set(true);
  }
}

/** Check now, on window focus, and whenever the override changes. Returns a stop. */
export function watchClaude(): () => void {
  void recheckClaude();
  window.addEventListener("focus", recheckClaude);
  let first = true;
  const unsub = claudeBinaryPath.subscribe(() => {
    if (first) first = false;
    else void recheckClaude();
  });
  return () => {
    window.removeEventListener("focus", recheckClaude);
    unsub();
  };
}

/** True when a hook is installed but its command differs from this build's. */
export const claudeHookStale = writable(false);

export async function refreshHookStale(): Promise<void> {
  try {
    const i = await claudeInfo();
    claudeHookStale.set([i.notificationHook, i.sessionStartHook].some((h) => h.kind === "installed" && !h.upToDate));
  } catch {
    claudeHookStale.set(false);
  }
}
