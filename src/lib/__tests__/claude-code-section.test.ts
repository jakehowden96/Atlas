// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  claudeInfo: vi.fn(),
  claudeCheck: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
  setClaudeHook: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import { claudeCheck, claudeInfo, setClaudeHook } from "../ipc";
import ClaudeCode from "../components/settings/sections/ClaudeCode.svelte";
import { claudeBinaryPath, settingsOpen } from "../stores/settings";
import type { ClaudeInfo } from "../../types/generated/ClaudeInfo";

const info = (over: Partial<ClaudeInfo> = {}): ClaudeInfo => ({
  binary: "/bin/claude",
  version: "2.0.0",
  notificationHookInstalled: true,
  sessionStartHookInstalled: true,
  notificationHook: { kind: "installed", upToDate: true },
  sessionStartHook: { kind: "installed", upToDate: true },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  settingsOpen.set(true);
  claudeBinaryPath.set("");
});
afterEach(cleanup);

describe("Settings > Claude Code", () => {
  it("maps each hook status to a word and offers Update only when out of date", async () => {
    vi.mocked(claudeInfo).mockResolvedValue(
      info({
        notificationHook: { kind: "installed", upToDate: false },
        sessionStartHook: { kind: "notInstalled" },
      }),
    );
    render(ClaudeCode);
    expect(await screen.findByText("Out of date")).toBeTruthy();
    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(1);

    await fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(setClaudeHook).toHaveBeenCalledWith(true);
  });

  it("shows Installed with no Update action when current", async () => {
    vi.mocked(claudeInfo).mockResolvedValue(info());
    render(ClaudeCode);
    expect(await screen.findAllByText("Installed")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("an invalid pick shows the error and does not save", async () => {
    vi.mocked(claudeInfo).mockResolvedValue(info());
    vi.mocked(open).mockResolvedValue("/tmp/nope");
    vi.mocked(claudeCheck).mockRejectedValue(new Error("not a file"));
    render(ClaudeCode);
    await fireEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not a file");
    expect(get(claudeBinaryPath)).toBe("");
  });

  it("a valid pick is saved", async () => {
    vi.mocked(claudeInfo).mockResolvedValue(info());
    vi.mocked(open).mockResolvedValue("/opt/claude");
    vi.mocked(claudeCheck).mockResolvedValue(info({ binary: "/opt/claude" }));
    render(ClaudeCode);
    await fireEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use default" })).toBeTruthy());
    expect(get(claudeBinaryPath)).toBe("/opt/claude");
  });
});
