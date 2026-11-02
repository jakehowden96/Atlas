// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";

const h = vi.hoisted(() => ({
  setLspTrusted: vi.fn(),
  setWorkspaceColor: vi.fn(),
  removeWorkspaceWithUndo: vi.fn(),
  stopServersFor: vi.fn(),
}));

vi.mock("../lsp-client", () => ({ stopServersFor: h.stopServersFor }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../stores/toast", () => ({ showToast: vi.fn() }));
vi.mock("../session-actions", () => ({
  addWorkspaceFolder: vi.fn(),
  removeWorkspaceWithUndo: h.removeWorkspaceWithUndo,
}));
vi.mock("../stores/prs", async () => {
  const { writable } = await import("svelte/store");
  return { repoSlugsByWorkspace: writable({}) };
});
vi.mock("../stores/settings", async () => {
  const { writable } = await import("svelte/store");
  return { lspTrustedWorkspaces: writable<string[]>([]), setLspTrusted: h.setLspTrusted };
});
vi.mock("../stores/workspace", async () => {
  const { writable } = await import("svelte/store");
  return {
    WORKSPACE_COLORS: ["#2fa37a", "#5b8def"],
    setWorkspaceColor: h.setWorkspaceColor,
    visibleWorkspaces: writable([{ path: "/w/a", name: "alpha", color: "#2fa37a", sessions: [] }]),
  };
});

import Workspaces from "../components/settings/sections/Workspaces.svelte";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Settings > Workspaces", () => {
  it("renders swatches as a named radio group and picks a colour", async () => {
    render(Workspaces);
    expect(screen.getByRole("radiogroup", { name: "Colour for alpha" })).toBeTruthy();
    const green = screen.getByRole("radio", { name: "green" });
    expect(green.getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(screen.getByRole("radio", { name: "blue" }));
    expect(h.setWorkspaceColor).toHaveBeenCalledWith("/w/a", "#5b8def");
  });

  it("language server switch calls the store", async () => {
    render(Workspaces);
    await fireEvent.click(screen.getByRole("switch", { name: "Language servers for alpha" }));
    expect(h.setLspTrusted).toHaveBeenCalledWith("/w/a", true);
  });

  it("Remove still calls the undo-backed removal", async () => {
    render(Workspaces);
    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(h.removeWorkspaceWithUndo).toHaveBeenCalledWith("/w/a");
  });
});
