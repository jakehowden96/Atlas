import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const classify = vi.hoisted(() => vi.fn());
const add = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const known = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({}) }));
vi.mock("../ipc", () => ({ classifyPaths: classify }));
vi.mock("../stores/toast", () => ({ showToast: toast }));
vi.mock("../stores/workspace", async () => {
  const { writable } = await import("svelte/store");
  return {
    addWorkspace: add,
    workspaces: {
      subscribe: (fn: (v: { path: string }[]) => void) =>
        writable(known.paths.map((path) => ({ path }))).subscribe(fn),
    },
  };
});

import { dragEntered, dragLeft, dragState, dropHint, handleDrop } from "../drop";

const dir = (path: string) => ({ path, isDir: true, exists: true });
const file = (path: string) => ({ path, isDir: false, exists: true });

beforeEach(() => {
  vi.clearAllMocks();
  known.paths = [];
  add.mockResolvedValue(true);
  dragLeft();
});

describe("drag state", () => {
  it("goes over with counts, then back to idle", async () => {
    classify.mockResolvedValue([dir("/a"), dir("/b")]);
    await dragEntered(["/a", "/b"]);
    expect(get(dragState)).toEqual({ kind: "over", folders: 2, files: 0 });
    expect(dropHint(get(dragState))).toBe("2 folders");
    dragLeft();
    expect(get(dragState).kind).toBe("idle");
  });

  it("says only folders can be added for a file", async () => {
    classify.mockResolvedValue([file("/f.txt")]);
    await dragEntered(["/f.txt"]);
    expect(dropHint(get(dragState))).toBe("Only folders can be added");
  });

  it("uses the singular for one folder", async () => {
    classify.mockResolvedValue([dir("/a")]);
    await dragEntered(["/a"]);
    expect(dropHint(get(dragState))).toBe("1 folder");
  });
});

describe("handleDrop", () => {
  it("adds folders and skips files", async () => {
    classify.mockResolvedValue([dir("/a"), dir("/b"), file("/f")]);
    await handleDrop(["/a", "/b", "/f"]);
    expect(add).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(
      "Added 2 workspaces",
      expect.objectContaining({ body: "Skipped 1 file" }),
    );
    expect(get(dragState).kind).toBe("idle");
  });

  it("does not re-add a known workspace", async () => {
    known.paths = ["/a"];
    classify.mockResolvedValue([dir("/a")]);
    await handleDrop(["/a"]);
    expect(add).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Already added", expect.anything());
  });

  it("rejects files with a message", async () => {
    classify.mockResolvedValue([file("/f"), file("/g")]);
    await handleDrop(["/f", "/g"]);
    expect(add).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Skipped 2 files", expect.anything());
  });
});
