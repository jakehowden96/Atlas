import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  createDir: vi.fn(async () => {}),
  deletePath: vi.fn(async () => {}),
  renamePath: vi.fn(async () => {}),
  listClaudePlans: vi.fn(async () => []),
  listDir: vi.fn(async () => ({ entries: [], truncated: false })),
  listWorkspaceDocs: vi.fn(async () => ({ entries: [], truncated: false })),
  readTextFileAt: vi.fn(),
  writeTextFileAt: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../stores/settings", async () => {
  const { openFiles } = await import("../stores/file-tabs");
  return {
    setFileSources: vi.fn(),
    setOpenFiles: vi.fn(async (keys: string[]) => openFiles.set(keys)),
  };
});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn(async () => () => {}), destroy: vi.fn() }),
}));
vi.mock("../stores/toast", () => ({ showToast: vi.fn() }));

import { createDir, deletePath, renamePath, listWorkspaceDocs } from "../ipc";
import { fileKey } from "../files";
import { showToast } from "../stores/toast";
import { openFiles } from "../stores/file-tabs";
import {
  activeFile,
  closeRequest,
  createFolder,
  deleteEntry,
  diskDocs,
  docs,
  expanded,
  fileWs,
  renameEntry,
} from "../stores/files";

const k = (p: string) => fileKey("/ws", p);

beforeEach(() => {
  vi.clearAllMocks();
  fileWs.set("/ws");
  openFiles.set([]);
  activeFile.set("");
  docs.set(new Map());
  diskDocs.set(new Map());
  expanded.set(new Set());
  closeRequest.set(null);
});

describe("renameEntry", () => {
  it("renames on disk and re-keys the tab, buffers and active file", async () => {
    openFiles.set([k("a.md"), k("b.md")]);
    activeFile.set(k("a.md"));
    docs.set(new Map([[k("a.md"), "edited"]]));
    diskDocs.set(new Map([[k("a.md"), "disk"]]));
    await renameEntry("/ws", "a.md", "c.md");
    expect(renamePath).toHaveBeenCalledWith("/ws/a.md", "/ws/c.md");
    expect(get(openFiles)).toEqual([k("c.md"), k("b.md")]);
    expect(get(activeFile)).toBe(k("c.md"));
    expect(get(docs).get(k("c.md"))).toBe("edited");
    expect(get(docs).has(k("a.md"))).toBe(false);
    expect(get(diskDocs).get(k("c.md"))).toBe("disk");
    expect(listWorkspaceDocs).toHaveBeenCalled();
  });

  it("re-keys everything under a renamed folder and keeps it expanded", async () => {
    openFiles.set([k("d/x.md"), k("dd/y.md")]);
    docs.set(new Map([[k("d/x.md"), "t"]]));
    expanded.set(new Set([k("d")]));
    await renameEntry("/ws", "d", "e");
    expect(get(openFiles)).toEqual([k("e/x.md"), k("dd/y.md")]);
    expect(get(docs).has(k("e/x.md"))).toBe(true);
    expect(get(expanded).has(k("e"))).toBe(true);
  });

  it("leaves state alone when the backend rejects", async () => {
    vi.mocked(renamePath).mockRejectedValueOnce(new Error("exists"));
    openFiles.set([k("a.md")]);
    await expect(renameEntry("/ws", "a.md", "b.md")).rejects.toThrow("exists");
    expect(get(openFiles)).toEqual([k("a.md")]);
  });

  it("rejects empty names and slashes before calling the backend", async () => {
    await expect(renameEntry("/ws", "a.md", "  ")).rejects.toThrow();
    await expect(renameEntry("/ws", "a.md", "x/y")).rejects.toThrow();
    expect(renamePath).not.toHaveBeenCalled();
  });
});

describe("deleteEntry", () => {
  it("trashes the path, closes clean tabs under it and toasts", async () => {
    openFiles.set([k("d/x.md"), k("keep.md")]);
    activeFile.set(k("d/x.md"));
    await deleteEntry("/ws", "d");
    expect(deletePath).toHaveBeenCalledWith("/ws/d");
    expect(get(openFiles)).toEqual([k("keep.md")]);
    expect(showToast).toHaveBeenCalledWith(
      "Moved d to the trash",
      expect.objectContaining({ type: "info" }),
    );
  });

  it("asks before closing a tab with unsaved edits", async () => {
    openFiles.set([k("a.md")]);
    docs.set(new Map([[k("a.md"), "unsaved"]]));
    await deleteEntry("/ws", "a.md");
    expect(get(closeRequest)).toEqual({ kind: "tab", key: k("a.md") });
    expect(get(openFiles)).toEqual([k("a.md")]);
  });

  it("keeps tabs open and surfaces the error when the backend rejects", async () => {
    vi.mocked(deletePath).mockRejectedValueOnce(new Error("denied"));
    openFiles.set([k("a.md")]);
    await expect(deleteEntry("/ws", "a.md")).rejects.toThrow("denied");
    expect(get(openFiles)).toEqual([k("a.md")]);
  });
});

describe("createFolder", () => {
  it("creates the directory and expands to it", async () => {
    await createFolder("/ws", "a", "b");
    expect(createDir).toHaveBeenCalledWith("/ws/a/b");
    expect(get(expanded)).toEqual(new Set([k("a"), k("a/b")]));
  });
});
