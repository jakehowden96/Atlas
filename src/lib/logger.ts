import { invoke } from "@tauri-apps/api/core";
import type { LogLevel } from "../types/generated/LogLevel";
import { errorMessage } from "./ipc-error";

/*
 * Frontend log lines go to the backend's log sink (`log_write`), so there is one
 * file, one format and one retention policy, and the webview needs no filesystem
 * access. This calls `invoke` directly rather than going through `ipc.ts`,
 * which itself logs.
 */

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.message}${err.stack ? "\n" + err.stack : ""}`;
  return errorMessage(err);
}

function write(level: LogLevel, scope: string, message: string) {
  // A log line that cannot be delivered is dropped: there is nowhere better to
  // report that, and logging must never throw into the caller.
  invoke("log_write", { level, scope, message }).catch((e) => {
    console.warn("[atlas-logger] could not write log line:", e);
  });
}

export const log = {
  info(source: string, message: string) {
    write("info", source, message);
  },

  warn(source: string, message: string) {
    write("warn", source, message);
  },

  error(source: string, message: string, err?: unknown) {
    write("error", source, err === undefined ? message : `${message}: ${formatError(err)}`);
  },
};
