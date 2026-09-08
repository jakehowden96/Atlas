import { writable } from "svelte/store";

/**
 * Mission Control toasts are two-line: a title in `--text` over an optional
 * body in `--muted`. Callers holding only one string pass it as the title.
 */
export interface Toast {
  id: string;
  title: string;
  body?: string;
  type: "error" | "warning" | "info";
}

/** The design's auto-dismiss figure. */
const TOAST_DURATION_MS = 4000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const toasts = writable<Toast[]>([]);

export function showToast(
  title: string,
  opts: { body?: string; type?: Toast["type"] } = {},
) {
  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, title, body: opts.body, type: opts.type ?? "error" }]);
  const timer = setTimeout(() => {
    timers.delete(id);
    dismissToast(id);
  }, TOAST_DURATION_MS);
  timers.set(id, timer);
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}
