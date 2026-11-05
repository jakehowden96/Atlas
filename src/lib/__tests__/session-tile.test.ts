// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { get } from "svelte/store";

const actions = vi.hoisted(() => ({
  allowPendingTool: vi.fn(),
  denyPendingTool: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("../session-actions", () => actions);
vi.mock("../stores/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/settings")>()),
  togglePinnedSession: vi.fn(),
}));
vi.mock("../stores/terminal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/terminal")>()),
  canAnswerPermission: () => true,
}));

import SessionTile from "../components/sessions/SessionTile.svelte";
import type { SessionTile as Tile } from "../overview";
import { focusedSessionId } from "../stores/view";
import type { LiveSession } from "../../types/generated/LiveSession";

function makeTile(over: Partial<Tile> = {}, live: Partial<LiveSession> = {}): Tile {
  return {
    sessionUuid: "u1",
    atlasSessionId: "row-1",
    terminalTabId: "tab-1",
    workspacePath: "/w",
    workspaceName: "work",
    workspaceColour: "#123456",
    label: "Fix the build",
    branch: "main",
    state: "needsYou",
    live: {
      sessionUuid: "u1",
      state: "running",
      startedAt: null,
      lastActivity: null,
      title: null,
      model: null,
      gitBranch: null,
      worktree: null,
      lines: [],
      plan: [],
      subagents: [],
      toolCalls: 0,
      lastTool: null,
      pendingTool: { name: "Bash", inputSummary: "ls" },
      outputTokens: 0,
      contextTokens: 0,
      peakContext: 0,
      contextPct: 0,
      lastPrompt: null,
      lastReply: null,
      turnEndedAt: null,
      turnDurationMs: null,
      ...live,
    } as LiveSession,
    diff: null,
    createdAt: "",
    ...over,
  };
}

function renderTile(tile = makeTile(), focusVisible = false) {
  return render(SessionTile, {
    tile,
    now: Date.now(),
    tailing: true,
    pinned: false,
    focused: true,
    focusVisible,
  });
}

beforeEach(() => {
  focusedSessionId.set("");
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("SessionTile", () => {
  it("has no button inside an element with role=button", () => {
    const { container } = renderTile();
    expect(container.querySelectorAll('[role="button"] button')).toHaveLength(0);
    expect(container.querySelector("article")).not.toBeNull();
  });

  it("Allow and Deny fire without opening the session", async () => {
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByRole("button", { name: /Allow/ }));
    await user.click(screen.getByRole("button", { name: /Deny/ }));
    expect(actions.allowPendingTool).toHaveBeenCalledWith("tab-1");
    expect(actions.denyPendingTool).toHaveBeenCalledWith("tab-1");
    expect(get(focusedSessionId)).toBe("");
  });

  it("opens the session from the label", async () => {
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByRole("button", { name: "Fix the build" }));
    expect(get(focusedSessionId)).toBe("row-1");
  });

  it("hides the diff delta when there is no diff", () => {
    const { container, unmount } = renderTile();
    expect(container.querySelector(".diff")).toBeNull();
    unmount();
    const { container: c2 } = renderTile(
      makeTile({ diff: { linesAdded: 3, linesRemoved: 1 } as Tile["diff"] }),
    );
    expect(c2.querySelector(".diff")?.textContent).toContain("+3");
  });

  it("draws the global focus ring when focus is visible", () => {
    const { container } = renderTile(makeTile(), true);
    const tile = container.querySelector(".tile") as HTMLElement;
    expect(tile.classList.contains("focus-ring")).toBe(true);
  });
});
