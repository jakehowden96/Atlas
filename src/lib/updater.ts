import { check } from "@tauri-apps/plugin-updater";
import { writable } from "svelte/store";
import tauriConf from "../../src-tauri/tauri.conf.json";
import { log } from "./logger";

export const PUBKEY_PLACEHOLDER = "REPLACE_WITH_UPDATER_PUBLIC_KEY";

export type UpdateState =
  | { kind: "notConfigured" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string; notes: string; date: string }
  | { kind: "error"; message: string };

export const updateState = writable<UpdateState>({ kind: "notConfigured" });

export function isUpdaterConfigured(
  pubkey: string | undefined = tauriConf.plugins.updater.pubkey,
): boolean {
  return !!pubkey && pubkey.trim() !== "" && pubkey !== PUBKEY_PLACEHOLDER;
}

let pending: Awaited<ReturnType<typeof check>> = null;

/** Never throws; never touches the network while the pubkey is the placeholder. */
export async function checkForUpdate(): Promise<UpdateState> {
  let state: UpdateState;
  if (!isUpdaterConfigured()) {
    state = { kind: "notConfigured" };
  } else {
    try {
      pending = await check();
      state = pending
        ? {
            kind: "available",
            version: pending.version,
            notes: pending.body ?? "",
            date: pending.date ?? "",
          }
        : { kind: "upToDate" };
    } catch (e) {
      log.warn("updater", `check failed: ${e}`);
      state = { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
  updateState.set(state);
  return state;
}

/** Downloads and installs the update found by the last check. `onProgress` gets 0..1 when the size is known. */
export async function installUpdate(
  onProgress?: (fraction: number) => void,
): Promise<UpdateState | null> {
  if (!pending) return null;
  let total = 0;
  let done = 0;
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        done += event.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(done / total, 1));
      }
    });
    return null;
  } catch (e) {
    log.warn("updater", `install failed: ${e}`);
    const state: UpdateState = {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
    updateState.set(state);
    return state;
  }
}

const HOUR_MS = 60 * 60 * 1000;

/** Hourly background check; returns a stop function. Wiring to an `autoCheckUpdates` setting is left to phase 77. */
export function startAutoCheck(isEnabled: () => boolean = () => true): () => void {
  if (!isUpdaterConfigured()) return () => {};
  const run = () => {
    if (isEnabled()) void checkForUpdate();
  };
  run();
  const id = setInterval(run, HOUR_MS);
  return () => clearInterval(id);
}
