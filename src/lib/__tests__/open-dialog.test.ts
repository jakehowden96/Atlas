// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home" }));
vi.mock("../ipc", () => ({
  filesGrant: vi.fn(),
  listDir: async () => ({
    truncated: false,
    entries: [
      { name: "a.md", path: "/home/a.md", is_dir: false, is_text: true },
      { name: "b.png", path: "/home/b.png", is_dir: false, is_text: false },
      { name: "c.md", path: "/home/c.md", is_dir: false, is_text: true },
    ],
  }),
}));

import OpenDialog from "../components/files/OpenDialog.svelte";
import { openDialogOpen } from "../stores/view";

afterEach(() => {
  cleanup();
  openDialogOpen.set(false);
});

Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });

describe("OpenDialog", () => {
  it("lists entries as options and arrows skip disabled ones", async () => {
    const user = userEvent.setup();
    openDialogOpen.set(true);
    render(OpenDialog);
    expect(screen.getByRole("dialog", { name: "Open file" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    screen.getByText("a.md").closest<HTMLElement>('[role="option"]')?.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByText("c.md").closest('[role="option"]'));
  });
});
