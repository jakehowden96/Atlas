/**
 * A fake Tauri backend for Storybook. Every `invoke` (app commands from `src/lib/ipc.ts` and
 * `plugin:*|*` calls) is answered from `routes`; `listen`/`emit` are mocked so stories can push
 * events. A route is a value, or a function of the command's args; a function that throws
 * rejects the call, so `{ kind: "connectorRateLimited", message, retryAt }` reaches the app as
 * an `IpcError` exactly like a real backend error.
 */
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

// Args are loose on purpose: each route reads the few fields its command sends.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Route = ((args: Record<string, any>) => unknown) | object | string | number | boolean | null;
export type Backend = Record<string, Route>;

/** Answers every story gets unless it overrides them via `parameters.backend`. */
const defaults: Backend = {
  state_load: { contents: null, recovered: false },
  state_save: null,
  list_workspace_repos: [],
  // The app logs through the backend; surface warnings and errors in the browser console.
  log_write: ({ level, scope, message }) => {
    if (level === "error") console.error(`[app:${scope}]`, message);
    else if (level === "warn") console.warn(`[app:${scope}]`, message);
    return null;
  },
  "plugin:app|version": "2.1.8",
  "plugin:updater|check": null,
  "plugin:notification|is_permission_granted": true,
};

export function installBackend(overrides: Backend = {}): void {
  clearMocks();
  mockWindows("main");
  const routes = { ...defaults, ...overrides };
  mockIPC(
    (cmd, args) => {
      if (cmd in routes) {
        const r = routes[cmd];
        return typeof r === "function" ? r((args ?? {}) as Record<string, unknown>) : r;
      }
      console.warn(`[sb-backend] unmocked command: ${cmd}`, args);
      return null;
    },
    { shouldMockEvents: true },
  );
}
