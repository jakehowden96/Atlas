import { writable } from "svelte/store";
import type { CodeburnInfo } from "../../types/generated/CodeburnInfo";
import { codeburnInfo, codeburnRun } from "../ipc";

/** `null` until the first probe; `binary: null` means codeburn is not installed. */
export const codeburnStatus = writable<CodeburnInfo | null>(null);

export async function checkCodeburn(): Promise<void> {
  codeburnStatus.set(await codeburnInfo());
}

/** A result younger than this is served without asking codeburn again. */
export const FRESH_MS = 5 * 60_000;
/** Queries viewed within this long keep being refreshed in the background. */
const KEEP_WARM_MS = 30 * 60_000;
/** Saved results not viewed for this long are dropped. */
const KEEP_SAVED_MS = 3 * 24 * 60 * 60_000;
const STORAGE_KEY = "atlas.codeburnCache.v1";
/** Only the most recently viewed results are saved, which also bounds the launch refresh. */
const MAX_SAVED = 50;

interface Entry {
  value?: unknown;
  at: number;
  usedAt: number;
  pending?: Promise<unknown>;
}
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<(value: unknown) => void>>();
let timer: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Last session's results, so Stats paints at once after a restart.
// shortcut: localStorage (~1MB here); move to a file in app data if it nears the quota.
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Entry>;
  for (const [key, e] of Object.entries(saved)) {
    if (Date.now() - e.usedAt < KEEP_SAVED_MS) cache.set(key, { value: e.value, at: e.at, usedAt: e.usedAt });
  }
} catch {
  // Unreadable or blocked storage: start empty.
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = Object.fromEntries(
      [...cache]
        .filter(([, e]) => e.value !== undefined)
        .sort(([, a], [, b]) => b.usedAt - a.usedAt)
        .slice(0, MAX_SAVED)
        .map(([key, e]) => [key, { value: e.value, at: e.at, usedAt: e.usedAt }]),
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // Over quota or blocked: the in-memory cache still works.
    }
  }, 2000);
}

const keyOf = (args: string[]) => args.join(" ");

function fetchInto<T>(key: string, args: string[], usedAt = Date.now()): Promise<T> {
  const entry = cache.get(key) ?? { at: 0, usedAt };
  if (entry.pending) return entry.pending as Promise<T>;
  const pending = codeburnRun<T>(args)
    .then((value) => {
      Object.assign(entry, { value, at: Date.now() });
      save();
      for (const fn of listeners.get(key) ?? []) fn(value);
      return value;
    })
    .finally(() => (entry.pending = undefined));
  entry.pending = pending;
  cache.set(key, entry);
  return pending;
}

/** The last result for `args`, however old, without querying. */
export function peekCodeburn<T>(args: string[]): T | undefined {
  return cache.get(keyOf(args))?.value as T | undefined;
}

/** Called with each new result for `args`, background refreshes included. */
export function onCodeburn<T>(args: string[], fn: (value: T) => void): () => void {
  const key = keyOf(args);
  const set = listeners.get(key) ?? new Set();
  set.add(fn as (value: unknown) => void);
  listeners.set(key, set);
  return () => {
    set.delete(fn as (value: unknown) => void);
    if (!set.size) listeners.delete(key);
  };
}

/**
 * Load `args` into the cache ahead of a view. It does not count as viewed,
 * so it is not kept warm unless someone opens it.
 */
export function warmCodeburn(args: string[]): Promise<unknown> {
  return fetchInto(keyOf(args), args, Date.now() - KEEP_WARM_MS);
}

/**
 * `codeburn <args>` as JSON, stale-while-revalidate: any cached result comes
 * back at once, and one older than FRESH_MS is re-queried in the background.
 * `fresh` (the Refresh button) waits for a new result instead.
 */
export function codeburn<T>(args: string[], fresh = false): Promise<T> {
  if (!timer) {
    timer = setInterval(() => void refreshWarm(), FRESH_MS);
    // Shortly after launch, bring every saved query up to date in the background.
    setTimeout(() => void refreshWarm(true), 5000);
  }
  const key = keyOf(args);
  const entry = cache.get(key);
  if (entry) entry.usedAt = Date.now();
  if (fresh || !entry || entry.value === undefined) return fetchInto<T>(key, args);
  if (Date.now() - entry.at >= FRESH_MS) fetchInto(key, args).catch(() => {});
  return Promise.resolve(entry.value as T);
}

/**
 * Re-query stale results one at a time: those viewed lately, or with `all`
 * every saved one (at launch).
 */
export async function refreshWarm(all = false): Promise<void> {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const now = Date.now();
  for (const [key, entry] of [...cache]) {
    if (listeners.get(key)?.size) entry.usedAt = now; // still on screen
    const idle = now - entry.usedAt;
    if (idle > KEEP_SAVED_MS) {
      if (!entry.pending) cache.delete(key);
      continue;
    }
    if ((!all && idle > KEEP_WARM_MS) || now - entry.at < FRESH_MS) continue;
    // A failed refresh keeps the last good result on screen.
    await fetchInto(key, key.split(" ")).catch(() => {});
  }
}
