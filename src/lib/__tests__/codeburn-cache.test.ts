// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
vi.mock("../ipc", () => ({ codeburnRun: (args: string[]) => run(args), codeburnInfo: vi.fn() }));

const { codeburn, FRESH_MS, onCodeburn, peekCodeburn, refreshWarm, warmCodeburn } = await import(
  "../stores/codeburn"
);

afterEach(() => {
  vi.useRealTimers();
  run.mockReset();
});

describe("codeburn cache", () => {
  it("serves a stale result at once and refreshes it in the background", async () => {
    vi.useFakeTimers();
    const args = ["status", "--format", "json", "--period", "t1"];
    run.mockResolvedValueOnce("old");
    expect(await codeburn(args)).toBe("old");
    expect(await codeburn(args)).toBe("old");
    expect(run).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + FRESH_MS + 1);
    let pushed: unknown;
    const stop = onCodeburn(args, (v) => (pushed = v));
    run.mockResolvedValueOnce("new");
    expect(await codeburn(args)).toBe("old");
    await vi.waitFor(() => expect(pushed).toBe("new"));
    expect(peekCodeburn(args)).toBe("new");
    stop();
  });

  it("fresh waits for a new result; a failed refresh keeps the old one", async () => {
    const args = ["status", "--format", "json", "--period", "t2"];
    run.mockResolvedValueOnce("a");
    await codeburn(args);
    run.mockResolvedValueOnce("b");
    expect(await codeburn(args, true)).toBe("b");
    run.mockRejectedValueOnce(new Error("boom"));
    await expect(codeburn(args, true)).rejects.toThrow("boom");
    expect(peekCodeburn(args)).toBe("b");
  });

  it("keeps viewed results warm but not prefetched ones", async () => {
    vi.useFakeTimers();
    const viewed = ["status", "--format", "json", "--period", "t4"];
    const warmed = ["status", "--format", "json", "--period", "t5"];
    run.mockResolvedValue("x");
    await codeburn(viewed);
    await warmCodeburn(warmed);
    run.mockClear();
    vi.setSystemTime(Date.now() + FRESH_MS + 1);
    await refreshWarm();
    // Earlier tests' entries share the module cache, so look only at these two.
    const mine = run.mock.calls.map((c) => c[0]).filter((a) => /t[45]$/.test(a.join(" ")));
    expect(mine).toEqual([viewed]);
  });
});

describe("codeburn cache on disk", () => {
  it("restores saved results after a restart", async () => {
    vi.useFakeTimers();
    const args = ["models", "--format", "json", "--period", "t3"];
    run.mockResolvedValueOnce(["saved"]);
    await codeburn(args);
    await vi.advanceTimersByTimeAsync(2500);
    vi.resetModules();
    const fresh = await import("../stores/codeburn");
    expect(fresh.peekCodeburn(args)).toEqual(["saved"]);
  });
});
