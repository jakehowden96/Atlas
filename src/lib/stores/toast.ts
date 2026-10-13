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
 *  carries an action, so there is time to reach for it. An error's body is
 *  often the only place its detail appears, so errors stay for 10s. */
const TOAST_DURATION_MS = 4000;
const TOAST_ACTION_DURATION_MS = 6000;
const TOAST_ERROR_DURATION_MS = 10_000;
/** Beyond this many, the oldest go: a failing loop must not bury the screen. */
const MAX_TOASTS = 4;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const toasts = writable<Toast[]>([]);

export function showToast(
  title: string,
  opts: { body?: string; type?: Toast["type"]; action?: Toast["action"] } = {},
) {
  const type = opts.type ?? "error";
  const duration = Math.max(
    opts.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS,
    type === "error" ? TOAST_ERROR_DURATION_MS : 0,
  );

  // The same message again while it is still up is one toast, not two: its
  // clock restarts and nothing stacks.
  const repeat = get(toasts).find(
    (t) =>
      t.title === title && t.body === opts.body && t.type === type && !t.action && !opts.action,
  );
  if (repeat) {
    clearTimeout(timers.get(repeat.id));
    timers.set(
      repeat.id,
      setTimeout(() => dismissToast(repeat.id), duration),
    );
    return;
  }

  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, title, body: opts.body, type, action: opts.action }]);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration),
  );
  for (const stale of get(toasts).slice(0, -MAX_TOASTS)) dismissToast(stale.id);
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
