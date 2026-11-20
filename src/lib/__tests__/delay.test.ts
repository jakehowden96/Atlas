// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { delayedFlag } from "../ui/delay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("delayedFlag", () => {
  it("fires true only after the delay and false immediately", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const f = delayedFlag((v) => seen.push(v));
    f.set(true);
    vi.advanceTimersByTime(999);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true]);
    f.set(false);
    expect(seen).toEqual([true, false]);
  });
  it("a load that ends under the delay never shows", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const f = delayedFlag((v) => seen.push(v));
    f.set(true);
    vi.advanceTimersByTime(500);
    f.set(false);
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([false]);
  });
});
