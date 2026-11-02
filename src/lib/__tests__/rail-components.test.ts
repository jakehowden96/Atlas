// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  setClaudeHook: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  stateLoad: vi.fn(async () => ({ contents: null, recovered: false })),
  stateSave: vi.fn(async () => undefined),
}));

import ThinRail from "../components/session/rail/ThinRail.svelte";
import MeterStrip from "../components/session/rail/MeterStrip.svelte";
import PlanTile from "../components/session/rail/PlanTile.svelte";
import { railTiles } from "../stores/settings";
import type { LiveSession } from "../../types/generated/LiveSession";

afterEach(() => {
  cleanup();
  railTiles.set({});
});

const marks = [
  { key: "plan", letter: "P", state: "running", sentence: "Plan: Step 1 of 2: a" },
  { key: "agents", letter: "A", state: "idle", sentence: "Agents: No agents yet" },
  { key: "pr", letter: "PR", state: "idle", sentence: "Pull request: none" },
] as const;

describe("ThinRail", () => {
  it("names each mark with a full sentence and says no ticket", () => {
    render(ThinRail, { marks: [...marks], waiting: false, ticketId: "", onexpand: () => {} });
    expect(screen.getByRole("button", { name: "Plan: Step 1 of 2: a" })).toBeTruthy();
    expect(screen.getByRole("toolbar")).toBeTruthy();
    expect(screen.getByText("no ticket")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Waiting for you" })).toBeNull();
  });

  it("shows the waiting mark", () => {
    render(ThinRail, { marks: [...marks], waiting: true, ticketId: "ENG-1", onexpand: () => {} });
    expect(screen.getByRole("img", { name: "Waiting for you" })).toBeTruthy();
    expect(screen.getByText("ENG-1")).toBeTruthy();
  });

  it("expands on click and moves between marks with the arrows", async () => {
    const onexpand = vi.fn();
    render(ThinRail, { marks: [...marks], waiting: false, ticketId: "", onexpand });
    const [plan, agents, pr] = screen.getAllByRole("button");
    plan!.focus();
    await fireEvent.keyDown(plan!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(agents);
    await fireEvent.keyDown(agents!, { key: "ArrowUp" });
    await fireEvent.keyDown(plan!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(pr);
    await fireEvent.click(agents!);
    expect(onexpand).toHaveBeenCalledWith("agents");
  });
});

describe("MeterStrip", () => {
  it("shows context, model with cost and elapsed", () => {
    const live = {
      contextPct: 0.64,
      model: "claude-sonnet-4-5",
      costEstimate: 4.18,
      startedAt: "2026-01-01T00:00:00Z",
    } as LiveSession;
    render(MeterStrip, { live, now: Date.parse("2026-01-01T00:48:12Z") });
    expect(screen.getByText("64%")).toBeTruthy();
    expect(screen.getByText("Sonnet")).toBeTruthy();
    expect(screen.getByText("$4.18")).toBeTruthy();
    expect(screen.getByText("48m 12s")).toBeTruthy();
    expect(screen.queryByText("Tools")).toBeNull();
  });
});

describe("PlanTile", () => {
  const plan = [
    { text: "one", status: "completed" },
    { text: "two", status: "in_progress" },
  ];

  it("auto-opens while running and the user's choice overrides it", async () => {
    render(PlanTile, { plan, workspacePath: undefined });
    const head = screen.getByRole("button", { name: /Step 2 of 2/ });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    await fireEvent.click(head);
    expect(get(railTiles).plan).toBe(false);
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays shut when settled and opens on a manual choice", async () => {
    render(PlanTile, { plan: [{ text: "one", status: "completed" }], workspacePath: undefined });
    const head = screen.getByRole("button", { name: /All 1 steps done/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });
});
