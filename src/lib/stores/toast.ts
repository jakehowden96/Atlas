import { derived, get, writable } from "svelte/store";

/**
 * Two-line toasts: a title over an optional body. Callers holding only one
 * string pass it as the title. An `action` adds a button before the close
 * control (the workspace-removal Undo).
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
/** Only this many show at once; the rest collapse into a "+n" line. */
export const MAX_VISIBLE_TOASTS = 3;
const MAX_LOG = 50;

function durationFor(type: Toast["type"], hasAction: boolean): number | null {
  if (type === "error") return null;
  return type === "warning" || hasAction ? TOAST_LONG_DURATION_MS : TOAST_DURATION_MS;
}

interface Timer {
  handle?: ReturnType<typeof setTimeout>;
  remaining: number;
  startedAt: number;
}
const timers = new Map<string, Timer>();

function startTimer(id: string, ms: number) {
  const t: Timer = { remaining: ms, startedAt: Date.now() };
  t.handle = setTimeout(() => dismissToast(id), ms);
  timers.set(id, t);
}

export const toasts = writable<Toast[]>([]);

/** The newest few, plus how many older ones are folded away. */
export const visibleToasts = derived(toasts, ($t) => ({
  shown: $t.slice(-MAX_VISIBLE_TOASTS),
  hidden: Math.max(0, $t.length - MAX_VISIBLE_TOASTS),
}));

export const notificationLog = writable<NotificationEntry[]>([]);

export function markAllRead() {
  notificationLog.update((l) => l.map((e) => ({ ...e, read: true })));
}

export function clearLog() {
  notificationLog.set([]);
}

export function showToast(
  title: string,
  opts: { body?: string; type?: Toast["type"]; action?: Toast["action"] } = {},
) {
  const type = opts.type ?? "error";
  const duration = durationFor(type, !!opts.action);

  // The same message again while it is still up is one toast, not two: its
  // clock restarts and nothing stacks.
  const repeat = get(toasts).find(
    (t) =>
      t.title === title && t.body === opts.body && t.type === type && !t.action && !opts.action,
  );
  if (repeat) {
    clearTimeout(timers.get(repeat.id)?.handle);
    if (duration !== null) startTimer(repeat.id, duration);
    return;
  }

  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, title, body: opts.body, type, action: opts.action }]);
  notificationLog.update((l) =>
    [...l, { id, title, body: opts.body, type, time: Date.now(), read: false }].slice(-MAX_LOG),
  );
  if (duration !== null) startTimer(id, duration);
}

/** Hold a toast's clock while the pointer or focus is on it. */
export function pauseToast(id: string) {
  const t = timers.get(id);
  if (!t?.handle) return;
  clearTimeout(t.handle);
  t.handle = undefined;
  t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
}

export function resumeToast(id: string) {
  const t = timers.get(id);
  if (!t || t.handle) return;
  startTimer(id, t.remaining);
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
  clearTimeout(timers.get(id)?.handle);
  timers.delete(id);
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}
