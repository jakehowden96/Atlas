import { get, writable } from "svelte/store";
import { toast as sonner } from "svelte-sonner";

/**
 * Two-line toasts: a title over an optional body. Callers holding only one
 * string pass it as the title. An `action` adds a button before the close
 * control (the workspace-removal Undo).
 *
 * svelte-sonner draws them and owns their clocks (hover and focus pause them);
 * this store keeps what is on screen and the Notifications log.
 */
export interface Toast {
  id: string;
  title: string;
  body?: string;
  type: "error" | "warning" | "info" | "success";
  action?: { label: string; run: () => void };
}

export interface NotificationEntry {
  id: string;
  title: string;
  body?: string;
  type: Toast["type"];
  time: number;
  read: boolean;
}

/** Info and success go after 5s, warnings after 8s, and a toast with an
 *  action also gets 8s so there is time to reach it. Errors never time out:
 *  their body is often the only place the detail appears. */
const TOAST_DURATION_MS = 5000;
const TOAST_LONG_DURATION_MS = 8000;
/** Only this many show at once; Sonner stacks the rest behind them. */
export const MAX_VISIBLE_TOASTS = 3;
const MAX_LOG = 50;

export function durationFor(type: Toast["type"], hasAction: boolean): number {
  if (type === "error") return Number.POSITIVE_INFINITY;
  return type === "warning" || hasAction ? TOAST_LONG_DURATION_MS : TOAST_DURATION_MS;
}

export const toasts = writable<Toast[]>([]);

export const notificationLog = writable<NotificationEntry[]>([]);

export function markAllRead() {
  notificationLog.update((l) => l.map((e) => ({ ...e, read: true })));
}

export function clearLog() {
  notificationLog.set([]);
}

/** Sonner closed it (timer, swipe or close button): drop it from the store. */
function forget(id: string) {
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}

function render(t: Toast) {
  sonner[t.type](t.title, {
    id: t.id,
    description: t.body,
    duration: durationFor(t.type, !!t.action),
    action: t.action ? { label: t.action.label, onClick: () => runToastAction(t.id) } : undefined,
    onDismiss: () => forget(t.id),
    onAutoClose: () => forget(t.id),
  });
}

export function showToast(
  title: string,
  opts: { body?: string; type?: Toast["type"]; action?: Toast["action"] } = {},
) {
  const type = opts.type ?? "error";

  // The same message again while it is still up is one toast, not two:
  // re-sending it under the same id restarts its clock and nothing stacks.
  const repeat = get(toasts).find(
    (t) =>
      t.title === title && t.body === opts.body && t.type === type && !t.action && !opts.action,
  );
  if (repeat) {
    render(repeat);
    return;
  }

  const t: Toast = { id: crypto.randomUUID(), title, body: opts.body, type, action: opts.action };
  toasts.update((list) => [...list, t]);
  notificationLog.update((l) =>
    [...l, { id: t.id, title, body: opts.body, type, time: Date.now(), read: false }].slice(
      -MAX_LOG,
    ),
  );
  render(t);
}

/**
 * Run a toast's action and take it off screen. Dismissing first leaves
 * nothing behind if the callback throws.
 */
export function runToastAction(id: string) {
  const action = get(toasts).find((t) => t.id === id)?.action;
  dismissToast(id);
  action?.run();
}

export function dismissToast(id: string) {
  forget(id);
  sonner.dismiss(id);
}
