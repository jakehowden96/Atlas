// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { get, type Writable } from "svelte/store";

vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  refreshPanel: vi.fn(async () => null),
}));
vi.mock("../stores/liveTiles", async () => {
  const { writable } = await import("svelte/store");
  return { liveTiles: writable([]) };
});
vi.mock("../session-actions", () => ({
  closeSession: vi.fn(),
  closeSessionForTab: vi.fn(),
  openSession: vi.fn(),
  handleTerminalExit: vi.fn(),
}));
vi.mock("../components/terminal/TerminalContainer.svelte", async () => ({
  default: (await import("./HarnessFixture.svelte")).default,
}));
vi.mock("../components/session/ActivityRail.svelte", async () => ({
  default: (await import("./HarnessFixture.svelte")).default,
}));
vi.mock("../components/changes/ChangesDrawer.svelte", async () => ({
  default: (await import("./HarnessFixture.svelte")).default,
}));

import SessionView from "../components/session/SessionView.svelte";
import TerminalTab from "../components/terminal/TerminalTab.svelte";
import { liveTiles } from "../stores/liveTiles";
import { activeTabId } from "../stores/terminal";
import { focusedSessionId } from "../stores/view";
import type { SessionTile } from "../overview";

function tile(n: number, state: SessionTile["state"]): SessionTile {
  return {
    sessionUuid: `u${n}`,
    atlasSessionId: `s${n}`,
    terminalTabId: `t${n}`,
    workspacePath: "/w",
    workspaceName: "ws",
    workspaceColour: "red",
    label: `Session ${n}`,
    branch: "main",
    state,
    live: {
      lastTool: "Edit",
      toolCalls: 9,
      contextTokens: 5000,
      startedAt: null,
    },
    diff: null,
    createdAt: "",
  } as unknown as SessionTile;
}

afterEach(cleanup);

describe("session view header", () => {
  it("lists other sessions in a menu and focuses the picked one", async () => {
    (liveTiles as unknown as Writable<unknown>).set([
      tile(1, "running"),
      tile(2, "needsYou"),
      tile(3, "idle"),
    ]);
    activeTabId.set("t1");
    focusedSessionId.set("s1");
    const user = userEvent.setup();
    render(SessionView);
    await user.click(screen.getByRole("button", { name: /Other sessions/ }));
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Session 2 · needs input"),
      expect.stringContaining("Session 3 · idle"),
    ]);
    expect(document.activeElement).toBe(rows[0]);
    await user.keyboard("{Enter}");
    expect(get(focusedSessionId)).toBe("s2");
  });

  it("footer has no totals", () => {
    (liveTiles as unknown as Writable<unknown>).set([tile(1, "running")]);
    activeTabId.set("t1");
    const { container } = render(SessionView);
    const foot = container.querySelector("footer")!;
    expect(foot.textContent).toContain("Edit");
    expect(foot.textContent).not.toMatch(/tools|ctx|\$/);
  });
});

describe("terminal loading overlay", () => {
  it("is a status, not an alert", async () => {
    render(TerminalTab, {
      tabId: "t",
      visible: true,
      ready: false,
      onPtyReady: vi.fn(),
      onSpawnError: vi.fn(),
    });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
