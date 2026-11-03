// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";

const retry = vi.hoisted(() => vi.fn());
vi.mock("../session-actions", () => ({
  closeSessionForTab: vi.fn(),
  handleTerminalExit: vi.fn(),
  retrySessionForTab: retry,
}));
vi.mock("../terminal-session", () => ({
  TerminalSession: class {
    destroy() {}
    handleVisibilityChange() {}
    fitTerminal() {}
  },
}));

import TerminalTab from "../components/terminal/TerminalTab.svelte";

afterEach(cleanup);

describe("TerminalTab spawn error", () => {
  it("offers Retry for the tab", async () => {
    render(TerminalTab, {
      tabId: "t1",
      visible: true,
      spawnError: "boom",
      onPtyReady: () => {},
      onSpawnError: () => {},
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("t1");
  });
});
