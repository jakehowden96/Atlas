// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({ claudeCheck: vi.fn() }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { claudeCheck } from "../ipc";
import ClaudeMissing, { INSTALL_COMMANDS } from "../components/shell/ClaudeMissing.svelte";
import { claudeMissing, recheckClaude } from "../stores/claude";
import { claudeBinaryPath } from "../stores/settings";

beforeEach(() => {
  claudeMissing.set(false);
  claudeBinaryPath.set("");
});
afterEach(cleanup);

describe("claudeMissing store", () => {
  it("is set when the check fails and cleared when it passes", async () => {
    vi.mocked(claudeCheck).mockRejectedValueOnce(new Error("nope"));
    await recheckClaude();
    expect(get(claudeMissing)).toBe(true);
    vi.mocked(claudeCheck).mockResolvedValueOnce({} as never);
    await recheckClaude();
    expect(get(claudeMissing)).toBe(false);
  });

  it("probes the saved override, or null for PATH", async () => {
    vi.mocked(claudeCheck).mockResolvedValue({} as never);
    await recheckClaude();
    expect(claudeCheck).toHaveBeenLastCalledWith(null);
    claudeBinaryPath.set("/x/claude");
    await recheckClaude();
    expect(claudeCheck).toHaveBeenLastCalledWith("/x/claude");
  });
});

describe("ClaudeMissing", () => {
  it("panel shows the install commands and the repair actions", () => {
    render(ClaudeMissing);
    expect(screen.getByText("Claude Code not found")).toBeTruthy();
    for (const c of INSTALL_COMMANDS) expect(screen.getByText(c.command)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose executable…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("banner variant is an alert with the same actions", () => {
    render(ClaudeMissing, { variant: "banner" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });
});
