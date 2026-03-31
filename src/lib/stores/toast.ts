import { writable } from "svelte/store";

export interface Toast {
  id: string;
  message: string;
  type: "error" | "warning" | "info";
}

const TOAST_DURATION_MS = 5000;

export const toasts = writable<Toast[]>([]);

export function showToast(message: string, type: Toast["type"] = "error") {
  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, message, type }]);
  setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
}

export function dismissToast(id: string) {
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}
