import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const sonner = vi.hoisted(() => {
  const fn = () => vi.fn();
  return { success: fn(), info: fn(), warning: fn(), error: fn(), dismiss: fn() };
});
vi.mock("svelte-sonner", () => ({ toast: sonner }));

import {
  toasts,
  notificationLog,
  markAllRead,
  clearLog,
  showToast,
  dismissToast,
  runToastAction,
} from "../stores/toast";

type Opts = {
  id: string;
  description?: string;
  duration: number;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
  onAutoClose: () => void;
};
const lastCall = (type: keyof typeof sonner) =>
  sonner[type].mock.calls[sonner[type].mock.calls.length - 1] as unknown as [string, Opts];

describe("toast store", () => {
  beforeEach(() => {
    toasts.set([]);
    clearLog();
    for (const f of Object.values(sonner)) f.mockClear();
  });

  it("hands the toast to Sonner with its type, body and id", () => {
    showToast("Pushed", { type: "success", body: "3 commits" });
    const [title, opts] = lastCall("success");
    expect(title).toBe("Pushed");
    expect(opts.description).toBe("3 commits");
    expect(opts.id).toBe(get(toasts)[0]!.id);
  });

  it("defaults to an error that never times out", () => {
    showToast("Could not save");
    expect(lastCall("error")[1].duration).toBe(Number.POSITIVE_INFINITY);
  });

  it.each([
    ["info", false, 5000],
    ["success", false, 5000],
    ["warning", false, 8000],
    ["info", true, 8000],
  ] as const)("gives a %s toast (action: %s) %ims", (type, withAction, ms) => {
    showToast("t", { type, action: withAction ? { label: "Undo", run: vi.fn() } : undefined });
    expect(lastCall(type)[1].duration).toBe(ms);
  });

  it("dismisses by id in the store and in Sonner", () => {
    showToast("First");
    showToast("Second");
    const id = get(toasts)[0]!.id;
    dismissToast(id);
    expect(get(toasts).map((t) => t.title)).toEqual(["Second"]);
    expect(sonner.dismiss).toHaveBeenCalledWith(id);
  });

  it("forgets a toast Sonner closed on its own", () => {
    showToast("Temporary", { type: "info" });
    lastCall("info")[1].onAutoClose();
    expect(get(toasts)).toHaveLength(0);
  });

  it("handles dismissing a non-existent toast gracefully", () => {
    showToast("Exists");
    dismissToast("non-existent-id");
    expect(get(toasts)).toHaveLength(1);
  });

  describe("action toasts", () => {
    it("runs the action once from Sonner's button and removes the toast", () => {
      const run = vi.fn();
      showToast("Atlas removed", { action: { label: "Undo", run } });
      const { action } = lastCall("error")[1];
      expect(action?.label).toBe("Undo");
      action!.onClick();
      expect(run).toHaveBeenCalledTimes(1);
      expect(get(toasts)).toHaveLength(0);
    });

    it("does not run the action when dismissed", () => {
      const run = vi.fn();
      showToast("Atlas removed", { action: { label: "Undo", run } });
      lastCall("error")[1].onDismiss();
      expect(get(toasts)).toHaveLength(0);
      expect(run).not.toHaveBeenCalled();
    });

    it("ignores runToastAction for an unknown id", () => {
      showToast("Exists");
      expect(() => runToastAction("non-existent-id")).not.toThrow();
      expect(get(toasts)).toHaveLength(1);
    });
  });

  it("shows a repeated identical toast once, re-sent under the same id", () => {
    showToast("Failed to list PRs", { body: "not found", type: "info" });
    showToast("Failed to list PRs", { body: "not found", type: "info" });
    expect(get(toasts)).toHaveLength(1);
    expect(get(notificationLog)).toHaveLength(1);
    const ids = sonner.info.mock.calls.map((c) => (c[1] as Opts).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  describe("notification log", () => {
    it("records every toast, unread, and survives dismissal", () => {
      showToast("One", { type: "info" });
      showToast("Two", { body: "detail" });
      dismissToast(get(toasts)[0]!.id);
      const log = get(notificationLog);
      expect(log.map((e) => [e.title, e.type, e.read])).toEqual([
        ["One", "info", false],
        ["Two", "error", false],
      ]);
      expect(log[1]!.body).toBe("detail");
    });

    it("keeps the last 50", () => {
      for (let i = 0; i < 60; i++) showToast(`n${i}`, { type: "info" });
      const log = get(notificationLog);
      expect(log).toHaveLength(50);
      expect(log[0]!.title).toBe("n10");
    });

    it("marks all read and clears", () => {
      showToast("One");
      markAllRead();
      expect(get(notificationLog).every((e) => e.read)).toBe(true);
      clearLog();
      expect(get(notificationLog)).toHaveLength(0);
    });
  });
});
