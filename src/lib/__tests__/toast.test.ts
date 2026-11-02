import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toasts,
  visibleToasts,
  notificationLog,
  markAllRead,
  clearLog,
  pauseToast,
  resumeToast,
  showToast,
  dismissToast,
  runToastAction,
} from "../stores/toast";
import { get } from "svelte/store";

describe("toast store", () => {
  beforeEach(() => {
    // Reset store
    toasts.set([]);
    clearLog();
    vi.useFakeTimers();
  });

  it("dismisses a toast by id", () => {
    showToast("First");
    showToast("Second");
    const items = get(toasts);
    dismissToast(items[0]!.id);
    expect(get(toasts)).toHaveLength(1);
    expect(get(toasts)[0]!.title).toBe("Second");
  });

  it("auto-dismisses an info toast after 5s", () => {
    showToast("Temporary", { type: "info" });
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(4999);
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(get(toasts)).toHaveLength(0);
  });

  it("cancels auto-dismiss timer on manual dismiss", () => {
    showToast("Manual dismiss");
    const items = get(toasts);
    const id = items[0]!.id;

    // Manually dismiss before timeout
    dismissToast(id);
    expect(get(toasts)).toHaveLength(0);

    // Advance past the auto-dismiss time — should not throw or re-remove
    vi.advanceTimersByTime(5000);
    expect(get(toasts)).toHaveLength(0);
  });

  it("handles dismissing a non-existent toast gracefully", () => {
    showToast("Exists");
    expect(get(toasts)).toHaveLength(1);

    // Dismiss a toast that doesn't exist
    dismissToast("non-existent-id");
    expect(get(toasts)).toHaveLength(1);
  });

  describe("action toasts", () => {
    it("holds an action toast for 8s, not 5s", () => {
      showToast("Atlas removed", { type: "info", action: { label: "Undo", run: vi.fn() } });
      vi.advanceTimersByTime(5000);
      expect(get(toasts)).toHaveLength(1);
      vi.advanceTimersByTime(2999);
      expect(get(toasts)).toHaveLength(1);
      vi.advanceTimersByTime(2);
      expect(get(toasts)).toHaveLength(0);
    });

    it("still dismisses a plain toast at 5s", () => {
      showToast("Plain", { type: "info" });
      vi.advanceTimersByTime(5001);
      expect(get(toasts)).toHaveLength(0);
    });

    it("runs the action once and removes the toast", () => {
      const run = vi.fn();
      showToast("Atlas removed", { action: { label: "Undo", run } });
      const id = get(toasts)[0]!.id;

      runToastAction(id);
      expect(run).toHaveBeenCalledTimes(1);
      expect(get(toasts)).toHaveLength(0);

      // The auto-dismiss timer was cleared with it, so nothing fires later.
      vi.advanceTimersByTime(8000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(get(toasts)).toHaveLength(0);
    });

    it("does not run the action when dismissed by the close button", () => {
      const run = vi.fn();
      showToast("Atlas removed", { action: { label: "Undo", run } });
      dismissToast(get(toasts)[0]!.id);
      expect(get(toasts)).toHaveLength(0);
      expect(run).not.toHaveBeenCalled();
    });

    it("does not run the action when it auto-dismisses", () => {
      const run = vi.fn();
      showToast("Atlas removed", { type: "info", action: { label: "Undo", run } });
      vi.advanceTimersByTime(8001);
      expect(get(toasts)).toHaveLength(0);
      expect(run).not.toHaveBeenCalled();
    });

    it("ignores runToastAction for an unknown id", () => {
      showToast("Exists");
      expect(() => runToastAction("non-existent-id")).not.toThrow();
      expect(get(toasts)).toHaveLength(1);
    });
  });

  it("can show multiple toasts and dismiss them independently", () => {
    showToast("First", { type: "error" });
    showToast("Second", { type: "info" });
    showToast("Third", { type: "warning" });
    expect(get(toasts)).toHaveLength(3);

    const items = get(toasts);
    dismissToast(items[1]!.id); // dismiss "Second"
    const remaining = get(toasts);
    expect(remaining).toHaveLength(2);
    expect(remaining[0]!.title).toBe("First");
    expect(remaining[1]!.title).toBe("Third");
  });

  it("keeps an error up until it is dismissed", () => {
    showToast("Could not save", { body: "disk full" });
    vi.advanceTimersByTime(600_000);
    expect(get(toasts)).toHaveLength(1);
  });

  it("holds a warning for 8s", () => {
    showToast("Careful", { type: "warning" });
    vi.advanceTimersByTime(7999);
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(get(toasts)).toHaveLength(0);
  });

  it("pauses the clock while hovered and resumes with the time left", () => {
    showToast("Hover me", { type: "info" });
    const id = get(toasts)[0]!.id;
    vi.advanceTimersByTime(3000);
    pauseToast(id);
    vi.advanceTimersByTime(60_000);
    expect(get(toasts)).toHaveLength(1);
    resumeToast(id);
    vi.advanceTimersByTime(1999);
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(get(toasts)).toHaveLength(0);
  });

  it("shows a repeated identical toast once and gives it a fresh lifetime", () => {
    showToast("Failed to list PRs", { body: "gh: not found", type: "info" });
    vi.advanceTimersByTime(3000);
    showToast("Failed to list PRs", { body: "gh: not found", type: "info" });
    expect(get(toasts)).toHaveLength(1);
    expect(get(notificationLog)).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(1001);
    expect(get(toasts)).toHaveLength(0);
  });

  it("shows only the newest three and counts the rest", () => {
    for (let i = 0; i < 10; i++) showToast(`Failure ${i}`);
    const { shown, hidden } = get(visibleToasts);
    expect(shown.map((t) => t.title)).toEqual(["Failure 7", "Failure 8", "Failure 9"]);
    expect(hidden).toBe(7);
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
