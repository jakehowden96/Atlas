import { writable } from "svelte/store";

export interface Toast {
  id: string;
  message: string;
  type: "error" | "warning" | "info";
}

const TOAST_DURATION_MS = 5000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const toasts = writable<Toast[]>([]);

export function showToast(message: string, type: Toast["type"] = "error") {
  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, message, type }]);
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
