import { describe, it, expect, vi, beforeEach } from "vitest";
import { toasts, showToast, dismissToast } from "../stores/toast";
import { get } from "svelte/store";

describe("toast store", () => {
  beforeEach(() => {
    // Reset store
    toasts.set([]);
    vi.useFakeTimers();
  });

  it("starts empty", () => {
    expect(get(toasts)).toEqual([]);
  });

  it("adds a toast via showToast", () => {
    showToast("Something went wrong");
    const items = get(toasts);
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("Something went wrong");
    expect(items[0].type).toBe("error");
  });

  it("supports different toast types", () => {
    showToast("Info message", "info");
    showToast("Warning message", "warning");
    const items = get(toasts);
    expect(items[0].type).toBe("info");
    expect(items[1].type).toBe("warning");
  });

  it("dismisses a toast by id", () => {
    showToast("First");
    showToast("Second");
    const items = get(toasts);
    dismissToast(items[0].id);
    expect(get(toasts)).toHaveLength(1);
    expect(get(toasts)[0].message).toBe("Second");
  });

  it("auto-dismisses after timeout", () => {
    showToast("Temporary");
    expect(get(toasts)).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(get(toasts)).toHaveLength(0);
  });

  it("cancels auto-dismiss timer on manual dismiss", () => {
    showToast("Manual dismiss");
    const items = get(toasts);
    const id = items[0].id;

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

  it("can show multiple toasts and dismiss them independently", () => {
    showToast("First", "error");
    showToast("Second", "info");
    showToast("Third", "warning");
    expect(get(toasts)).toHaveLength(3);

    const items = get(toasts);
    dismissToast(items[1].id); // dismiss "Second"
    const remaining = get(toasts);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].message).toBe("First");
    expect(remaining[1].message).toBe("Third");
  });
});
