import { writable } from "svelte/store";
import type { CodeburnInfo } from "../../types/generated/CodeburnInfo";
import { codeburnInfo, codeburnRun } from "../ipc";

/** `null` until the first probe; `binary: null` means codeburn is not installed. */
export const codeburnStatus = writable<CodeburnInfo | null>(null);

export async function checkCodeburn(): Promise<void> {
  codeburnStatus.set(await codeburnInfo());
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/**
 * `codeburn <args>` as JSON, shared by argv for a minute so switching tabs or
 * periods back and forth does not re-scan every transcript. `fresh` skips it.
 * shortcut: time-based only, not driven by transcript changes; upgrade if a
 * minute of staleness bothers anyone.
 */
export function codeburn<T>(args: string[], fresh = false): Promise<T> {
  const key = args.join(" ");
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = codeburnRun<T>(args);
  cache.set(key, { at: Date.now(), value });
  // A failure must not be served from the cache for the next minute.
  value.catch(() => cache.delete(key));
  return value;
}
