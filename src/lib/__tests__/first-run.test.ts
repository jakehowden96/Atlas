import { describe, expect, it } from "vitest";
import type { ClaudeInfo } from "../../types/generated/ClaudeInfo";
import { deriveFirstRun } from "../first-run";

const info = (over: Partial<ClaudeInfo> = {}): ClaudeInfo => ({
  binary: "/usr/bin/claude",
  version: "2.0.0",
  notificationHookInstalled: true,
  sessionStartHookInstalled: true,
  notificationHook: { kind: "installed", upToDate: true },
  sessionStartHook: { kind: "installed", upToDate: true },
  ...over,
});

const done = (c: ClaudeInfo | null, n: number) => deriveFirstRun(c, n).items.map((i) => i.done);

describe("deriveFirstRun", () => {
  it("is all incomplete before claude_info answers", () => {
    const r = deriveFirstRun(null, 0);
    expect(r.items.map((i) => i.done)).toEqual([false, false, false]);
    expect(r.allDone).toBe(false);
  });

  it("tracks each item independently", () => {
    expect(done(info({ binary: null }), 0)).toEqual([false, true, false]);
    expect(done(info({ sessionStartHook: { kind: "notInstalled" } }), 1)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("treats an out-of-date hook as not done", () => {
    const stale = { kind: "installed", upToDate: false } as const;
    expect(done(info({ sessionStartHook: stale }), 1)).toEqual([true, false, true]);
    expect(done(info({ notificationHook: { kind: "notInstalled" } }), 1)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("is complete when everything is done", () => {
    expect(deriveFirstRun(info(), 2).allDone).toBe(true);
  });
});
