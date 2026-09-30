import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  listClaudePlans: vi.fn(),
  listDir: vi.fn(),
  listWorkspaceDocs: vi.fn(),
  readTextFileAt: vi.fn(),
  writeTextFileAt: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../stores/settings", () => ({
  setFileSources: vi.fn(),
  setOpenFiles: vi.fn(),
}));
type CloseHandler = (e: { preventDefault: () => void }) => void;
/** The guard registers once per module load, so the handler outlives each test's mock reset. */
let closeHandler: CloseHandler | undefined;
const windowApi = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowApi }));
vi.mock("../stores/toast", () => ({ showToast: vi.fn() }));

import { setOpenFiles } from "../stores/settings";
import { listWorkspaceDocs, readTextFileAt, writeTextFileAt } from "../ipc";
import { fileKey } from "../files";
import {
  activeFile,
  closeRequest,
  conflicts,
  requestCloseFile,
  resolveCloseRequest,
  handleExternalChange,
  reloadFromDisk,
  keepMine,
  listError,
  loadDocs,
  diskDocs,
  docs,
  loadFileText,
  openFiles,
  saveActiveFile,
  setDoc,
  unreadable,
} from "../stores/files";

const key = fileKey("/ws", "big.md");

beforeEach(() => {
  vi.clearAllMocks();
  docs.set(new Map());
  diskDocs.set(new Map());
  unreadable.set(new Set());
  conflicts.set(new Set());
  closeRequest.set(null);
  windowApi.onCloseRequested.mockImplementation(async (handler: CloseHandler) => {
    closeHandler = handler;
    return () => {};
  });
  openFiles.set([]);
  activeFile.set(key);
});

describe("saveActiveFile", () => {
  it("refuses to write over a file that failed to load", async () => {
    vi.mocked(readTextFileAt).mockRejectedValue("too big");
    await loadFileText(key);
    setDoc(key, "x");
    await saveActiveFile();
    expect(writeTextFileAt).not.toHaveBeenCalled();
  });

  it("keeps an edit typed while the write was in flight", async () => {
    vi.mocked(readTextFileAt).mockResolvedValue("");
    await loadFileText(key);
    let finish!: () => void;
    vi.mocked(writeTextFileAt).mockReturnValue(new Promise<void>((r) => (finish = r)));

    setDoc(key, "a");
    const saving = saveActiveFile();
    setDoc(key, "ab");
    finish();
    await saving;

    expect(get(docs).get(key)).toBe("ab");
    expect(get(diskDocs).get(key)).toBe("a");
  });

  it("marks the file clean when nothing changed during the write", async () => {
    vi.mocked(readTextFileAt).mockResolvedValue("");
    await loadFileText(key);
    vi.mocked(writeTextFileAt).mockResolvedValue(undefined);
    setDoc(key, "a");
    await saveActiveFile();
    expect(get(docs).has(key)).toBe(false);
    expect(get(diskDocs).get(key)).toBe("a");
  });
});

describe("external changes to an open file", () => {
  const ws = "/ws";
  const noteKey = fileKey(ws, "a.md");

  async function openLoaded(disk: string) {
    openFiles.set([noteKey]);
    activeFile.set(noteKey);
    vi.mocked(readTextFileAt).mockResolvedValue(disk);
    await loadFileText(noteKey);
    vi.mocked(readTextFileAt).mockClear();
  }

  it("reloads a clean file when it changes on disk", async () => {
    await openLoaded("old");
    vi.mocked(readTextFileAt).mockResolvedValue("new");
    await handleExternalChange(ws, "a.md");
    expect(get(diskDocs).get(noteKey)).toBe("new");
    expect(get(conflicts).size).toBe(0);
  });

  it("flags a conflict instead of overwriting unsaved edits", async () => {
    await openLoaded("old");
    setDoc(noteKey, "mine");
    vi.mocked(readTextFileAt).mockResolvedValue("theirs");
    await handleExternalChange(ws, "a.md");
    expect(get(docs).get(noteKey)).toBe("mine");
    expect(get(conflicts).has(noteKey)).toBe(true);

    await saveActiveFile();
    expect(writeTextFileAt).not.toHaveBeenCalled();
  });

  it("ignores the echo of its own save", async () => {
    await openLoaded("old");
    setDoc(noteKey, "mine");
    vi.mocked(writeTextFileAt).mockResolvedValue(undefined);
    await saveActiveFile();
    setDoc(noteKey, "mine and more");
    vi.mocked(readTextFileAt).mockResolvedValue("mine");
    await handleExternalChange(ws, "a.md");
    expect(get(conflicts).size).toBe(0);
  });

  it("does not read files that are not open", async () => {
    await handleExternalChange(ws, "other.md");
    expect(readTextFileAt).not.toHaveBeenCalled();
  });

  it("lets the user take the disk version or keep their own", async () => {
    await openLoaded("old");
    setDoc(noteKey, "mine");
    vi.mocked(readTextFileAt).mockResolvedValue("theirs");
    await handleExternalChange(ws, "a.md");

    keepMine(noteKey);
    vi.mocked(writeTextFileAt).mockResolvedValue(undefined);
    await saveActiveFile();
    expect(writeTextFileAt).toHaveBeenCalledWith("/ws/a.md", "mine");

    setDoc(noteKey, "again");
    await handleExternalChange(ws, "a.md");
    await reloadFromDisk(noteKey);
    expect(get(docs).has(noteKey)).toBe(false);
    expect(get(diskDocs).get(noteKey)).toBe("theirs");
    expect(get(conflicts).size).toBe(0);
  });
});

describe("closing a tab with unsaved edits", () => {
  const tab = fileKey("/ws", "n.md");

  beforeEach(async () => {
    openFiles.set([tab]);
    activeFile.set(tab);
    vi.mocked(readTextFileAt).mockResolvedValue("disk");
    await loadFileText(tab);
  });

  it("closes a clean tab straight away", () => {
    requestCloseFile(tab);
    expect(setOpenFiles).toHaveBeenLastCalledWith([]);
    expect(get(closeRequest)).toBeNull();
  });

  it("asks first and keeps the edit when the user cancels", async () => {
    setDoc(tab, "typed");
    requestCloseFile(tab);
    expect(get(closeRequest)).toEqual({ kind: "tab", key: tab });
    expect(setOpenFiles).not.toHaveBeenCalled();

    await resolveCloseRequest("cancel");
    expect(setOpenFiles).not.toHaveBeenCalled();
    expect(get(docs).get(tab)).toBe("typed");
  });

  it("discards the edit on request", async () => {
    setDoc(tab, "typed");
    requestCloseFile(tab);
    await resolveCloseRequest("discard");
    expect(setOpenFiles).toHaveBeenLastCalledWith([]);
    expect(writeTextFileAt).not.toHaveBeenCalled();
  });

  it("saves before closing, and stays open if the save fails", async () => {
    setDoc(tab, "typed");
    requestCloseFile(tab);
    vi.mocked(writeTextFileAt).mockRejectedValue(new Error("denied"));
    await resolveCloseRequest("save");
    expect(setOpenFiles).not.toHaveBeenCalled();

    requestCloseFile(tab);
    vi.mocked(writeTextFileAt).mockResolvedValue(undefined);
    await resolveCloseRequest("save");
    expect(writeTextFileAt).toHaveBeenLastCalledWith("/ws/n.md", "typed");
    expect(setOpenFiles).toHaveBeenLastCalledWith([]);
  });
});

describe("quitting with unsaved edits", () => {
  const tab = fileKey("/ws", "q.md");

  async function guard() {
    setDoc(tab, "typed");
    await vi.waitFor(() => expect(closeHandler).toBeDefined());
    return closeHandler as CloseHandler;
  }

  it("blocks the window close and asks, then quits on discard", async () => {
    const handler = await guard();
    const event = { preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(get(closeRequest)).toEqual({ kind: "quit" });

    await resolveCloseRequest("discard");
    expect(windowApi.destroy).toHaveBeenCalled();
  });

  it("does not quit when saving one of the files fails", async () => {
    const handler = await guard();
    handler({ preventDefault: vi.fn() });
    vi.mocked(writeTextFileAt).mockRejectedValue(new Error("denied"));
    await resolveCloseRequest("save");
    expect(windowApi.destroy).not.toHaveBeenCalled();
  });
});

describe("listing failures", () => {
  it("reports why the tree is empty, and clears it once a listing works", async () => {
    vi.mocked(listWorkspaceDocs).mockRejectedValueOnce("permission denied");
    await loadDocs("/ws");
    expect(get(listError)).toContain("permission denied");

    vi.mocked(listWorkspaceDocs).mockResolvedValueOnce([]);
    await loadDocs("/ws");
    expect(get(listError)).toBe("");
  });
});
