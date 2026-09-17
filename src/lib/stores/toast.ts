import { get, writable } from "svelte/store";

/**
 * Mission Control toasts are two-line: a title in `--text` over an optional
 * body in `--muted`. Callers holding only one string pass it as the title.
 * An `action` adds a button before the ✕ — the workspace-removal Undo.
 */
export interface Toast {
  id: string;
  title: string;
  body?: string;
  type: "error" | "warning" | "info";
  action?: { label: string; run: () => void };
}

/** The design's auto-dismiss figures: 4s, stretched to 6s when a toast
 *  carries an action, so there is time to reach for it. */
const TOAST_DURATION_MS = 4000;
const TOAST_ACTION_DURATION_MS = 6000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const toasts = writable<Toast[]>([]);

export function showToast(
  title: string,
  opts: { body?: string; type?: Toast["type"]; action?: Toast["action"] } = {},
) {
  const id = crypto.randomUUID();
  toasts.update((t) => [
    ...t,
    { id, title, body: opts.body, type: opts.type ?? "error", action: opts.action },
  ]);
  const timer = setTimeout(() => {
    timers.delete(id);
    dismissToast(id);
  }, opts.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
  timers.set(id, timer);
}

/**
 * Run a toast's action and take it off screen. Dismissing first routes the
 * timer cleanup through `dismissToast` rather than repeating it here, and
 * leaves nothing behind if the callback throws.
 */
export function runToastAction(id: string) {
  const action = get(toasts).find((t) => t.id === id)?.action;
  dismissToast(id);
  action?.run();
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}
