import { describe, expect, it } from "vitest";

import type { PlanItem } from "../../types/generated/PlanItem";
import type { Subagent } from "../../types/generated/Subagent";
import {
  agentRows,
  agentsDetail,
  agentsHeadline,
  agentsState,
  autoOpen,
  branchLine,
  contextPercent,
  headlineText,
  middleEllipsis,
  modelInfo,
  planHeadline,
  planOpenHeadline,
  planRows,
  planState,
  spansWorktrees,
  tileOpen,
  waitingSummary,
} from "../session-view";
import { cycleRail } from "../stores/view";

const step = (text: string, status: string): PlanItem => ({ text, status });
const fourteen = (): PlanItem[] =>
  Array.from({ length: 14 }, (_, i) =>
    step(
      i === 10 ? "Parse Retry-After as an HTTP date" : `s${i + 1}`,
      i < 10 ? "completed" : i === 10 ? "in_progress" : "pending",
    ),
  );

function agent(o: Partial<Subagent> = {}): Subagent {
  return {
    task: "Search",
    agentType: null,
    startedAt: null,
    finishedAt: null,
    toolCount: 0,
    done: false,
    worktree: null,
    currentAction: null,
    ...o,
  };
}

describe("plan strings", () => {
  it("names the current step", () => {
    expect(headlineText(planHeadline(fourteen()))).toBe(
      "Step 11 of 14: Parse Retry-After as an HTTP date",
    );
    expect(planOpenHeadline(fourteen())).toBe("Step 11 of 14, 10 done");
    expect(planState(fourteen())).toBe("running");
  });

  it("covers finished and empty plans", () => {
    const done = Array.from({ length: 6 }, () => step("x", "completed"));
    expect(headlineText(planHeadline(done))).toBe("All 6 steps done");
    expect(planState(done)).toBe("done");
    expect(headlineText(planHeadline([]))).toBe("No plan yet");
    expect(planState([])).toBe("idle");
  });

  it("splits rows into running, next and done", () => {
    const rows = planRows(fourteen());
    expect(rows.running).toHaveLength(1);
    expect(rows.running[0]!.word).toBe("in progress");
    expect(rows.running[0]!.rest).toBe(" · step 11 of 14");
    expect(rows.next[0]!.rest).toBe(" · step 12");
    expect(rows.done).toHaveLength(10);
  });
});

describe("agent strings", () => {
  const now = Date.parse("2026-01-01T00:07:28Z");
  const start = "2026-01-01T00:00:00Z";

  it("summarises running and done counts", () => {
    const list = [
      ...Array.from({ length: 4 }, () => agent()),
      ...Array.from({ length: 5 }, () => agent({ done: true })),
    ];
    expect(headlineText(agentsHeadline(list))).toBe("4 running, 5 done");
    expect(agentsHeadline(list).lead).toBe("4 running");
    expect(agentsState(list)).toBe("running");
    expect(headlineText(agentsHeadline([]))).toBe("No agents yet");
    expect(headlineText(agentsHeadline([agent({ done: true })]))).toBe("1 done");
    expect(agentsState([agent({ done: true })])).toBe("done");
  });

  it("lists two running tasks then a count", () => {
    const list = ["a", "b", "c", "d"].map((task) => agent({ task }));
    expect(agentsDetail(list)).toBe("a, b, +2");
  });

  it("builds running and done status lines", () => {
    const rows = agentRows(
      [
        agent({
          startedAt: start,
          toolCount: 14,
          currentAction: "Reading src/retry.rs",
          agentType: "Explore",
        }),
        agent({ startedAt: start, finishedAt: "2026-01-01T00:01:05Z", toolCount: 6, done: true }),
      ],
      now,
      false,
    );
    expect(`${rows.running[0]!.word}${rows.running[0]!.rest}`).toBe(
      "running 7m 28s, 14 tool calls",
    );
    expect(rows.running[0]!.action).toBe("Reading src/retry.rs");
    expect(rows.running[0]!.meta).toBe("Explore");
    expect(`${rows.done[0]!.word}${rows.done[0]!.rest}`).toBe("done in 1m 05s, 6 tool calls");
  });

  it("shows the worktree chip only when worktrees differ", () => {
    const a = agent({ worktree: "retry-metrics" });
    expect(spansWorktrees(null, [agent()])).toBe(false);
    expect(spansWorktrees(null, [a])).toBe(true);
    expect(agentRows([a], now, false).running[0]!.chip).toBeUndefined();
    expect(agentRows([a], now, true).running[0]!.chip).toBe("retry-metrics");
  });
});

describe("header strings", () => {
  it("ellipsises the middle of a long branch line", () => {
    expect(middleEllipsis("short")).toBe("short");
    const long = middleEllipsis("atlas/billing-retry-with-a-very-long-name · retry-metrics");
    expect(long).toHaveLength(36);
    expect(long).toContain("…");
    expect(long.startsWith("atlas/")).toBe(true);
    expect(long.endsWith("retry-metrics")).toBe(true);
  });

  it("joins branch and worktree", () => {
    expect(branchLine("atlas/x", "wt")).toBe("atlas/x · wt");
    expect(branchLine("atlas/x", null)).toBe("atlas/x");
    expect(branchLine(null, null)).toBe("");
  });

  it("names the model and clamps context", () => {
    expect(modelInfo("claude-sonnet-4-5-20250929")).toEqual({ name: "Sonnet", family: "sonnet" });
    expect(modelInfo(null).family).toBeNull();
    expect(contextPercent(0.644)).toBe(64);
    expect(contextPercent(3)).toBe(100);
  });

  it("summarises what the session waits for", () => {
    expect(waitingSummary({ name: "Bash" })).toBe("wants to run Bash");
    expect(waitingSummary(null)).toBe("needs your answer");
  });
});

describe("tile state machine", () => {
  it("opens on running, failing and attention only", () => {
    expect(["running", "failing", "attention"].every((s) => autoOpen(s as never))).toBe(true);
    expect(autoOpen("done")).toBe(false);
    expect(autoOpen("idle")).toBe(false);
  });

  it("lets a manual choice beat the automatic one", () => {
    expect(tileOpen("running", undefined)).toBe(true);
    expect(tileOpen("running", false)).toBe(false);
    expect(tileOpen("done", true)).toBe(true);
    expect(tileOpen("done", undefined)).toBe(false);
  });
});

describe("cycleRail", () => {
  it("steps expanded, thin, hidden, expanded", () => {
    expect(cycleRail(true, "expanded")).toEqual({ open: true, width: "thin" });
    expect(cycleRail(true, "thin")).toEqual({ open: false, width: "thin" });
    expect(cycleRail(false, "thin")).toEqual({ open: true, width: "expanded" });
  });
});
