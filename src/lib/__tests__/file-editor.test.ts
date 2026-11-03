// @vitest-environment happy-dom
import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";

vi.mock("../ipc", () => ({ openUrl: vi.fn(), readTextFileAt: vi.fn() }));

import FileEditor from "../components/files/FileEditor.svelte";
import { openFiles } from "../stores/file-tabs";
import { activeFile, conflicts, diskDocs, docs } from "../stores/files";
import { openDialogOpen } from "../stores/view";

Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });

afterEach(() => {
  cleanup();
  openFiles.set([]);
  activeFile.set("");
  conflicts.set(new Set());
  docs.set(new Map());
  diskDocs.set(new Map());
  openDialogOpen.set(false);
});

function open(...keys: string[]) {
  diskDocs.set(new Map(keys.map((k) => [k, "# hi"])));
  openFiles.set(keys);
  activeFile.set(keys[0] ?? "");
}

describe("FileEditor", () => {
  it("empty state opens the open dialog", async () => {
    render(FileEditor);
    expect(screen.getByText("No file open")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open a file…" }));
    expect(get(openDialogOpen)).toBe(true);
  });

  it("tabs follow the store and selecting one activates it", async () => {
    open("/a.md", "/b.md");
    render(FileEditor);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    await userEvent.click(screen.getByRole("tab", { name: "b.md" }));
    expect(get(activeFile)).toBe("/b.md");
  });

  it("closing a clean tab removes it", async () => {
    open("/a.md");
    render(FileEditor);
    await userEvent.click(screen.getByRole("button", { name: "Close a.md" }));
    expect(get(openFiles)).toEqual([]);
  });

  it("conflict banner Keep mine clears the conflict", async () => {
    open("/a.md");
    conflicts.set(new Set(["/a.md"]));
    render(FileEditor);
    expect(screen.getByRole("button", { name: "Reload from disk" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(get(conflicts).size).toBe(0);
  });
});
