import { describe, it, expect, vi, beforeEach } from "vitest";
import { toasts, showToast, dismissToast, runToastAction } from "../stores/toast";
import { get } from "svelte/store";

describe("toast store", () => {
  beforeEach(() => {
    // Reset store
    toasts.set([]);
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

  it("auto-dismisses an info toast after 4s", () => {
    showToast("Temporary", { type: "info" });
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(3999);
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
    vi.advanceTimersByTime(4000);
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
    it("holds an action toast for 6s, not 4s", () => {
      showToast("Atlas removed", { type: "info", action: { label: "Undo", run: vi.fn() } });
      vi.advanceTimersByTime(4000);
      expect(get(toasts)).toHaveLength(1);
      vi.advanceTimersByTime(1999);
      expect(get(toasts)).toHaveLength(1);
      vi.advanceTimersByTime(2);
      expect(get(toasts)).toHaveLength(0);
    });

    it("still dismisses a plain toast at 4s", () => {
      showToast("Plain", { type: "info" });
      vi.advanceTimersByTime(4001);
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
      vi.advanceTimersByTime(6000);
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
      vi.advanceTimersByTime(6001);
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

  it("keeps an error up longer than an info toast, since its body is the only detail", () => {
    showToast("Could not save", { body: "disk full" });
    vi.advanceTimersByTime(4001);
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(6000);
    expect(get(toasts)).toHaveLength(0);
  });

  it("shows a repeated identical toast once and gives it a fresh lifetime", () => {
    showToast("Failed to list PRs", { body: "gh: not found", type: "info" });
    vi.advanceTimersByTime(3000);
    showToast("Failed to list PRs", { body: "gh: not found", type: "info" });
    expect(get(toasts)).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(1001);
    expect(get(toasts)).toHaveLength(0);
  });

  it("keeps only the newest few when many pile up", () => {
    for (let i = 0; i < 10; i++) showToast(`Failure ${i}`);
    const titles = get(toasts).map((t) => t.title);
    expect(titles).toEqual(["Failure 6", "Failure 7", "Failure 8", "Failure 9"]);
  });
});
