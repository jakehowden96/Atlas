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
import { listDir, listWorkspaceDocs, readTextFileAt, writeTextFileAt } from "../ipc";
import { fileKey } from "../files";
import type { TextFile, WriteOutcome } from "../../types/files";
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
  loadSourceFiles,
  truncatedSources,
  saveActiveFile,
  setDoc,
  unreadable,
} from "../stores/files";
import { openFiles } from "../stores/file-tabs";

const key = fileKey("/ws", "big.md");

/** What the backend returns for a read; the time defaults to 1. */
const file = (contents: string, mtime = 1): TextFile => ({ contents, mtime });
const saved = (mtime = 2): WriteOutcome => ({ kind: "saved", mtime });

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
    vi.mocked(readTextFileAt).mockResolvedValue(file(""));
    await loadFileText(key);
    let finish!: () => void;
    vi.mocked(writeTextFileAt).mockReturnValue(
      new Promise<WriteOutcome>((r) => (finish = () => r(saved()))),
    );

    setDoc(key, "a");
    const saving = saveActiveFile();
    setDoc(key, "ab");
    finish();
    await saving;

    expect(get(docs).get(key)).toBe("ab");
    expect(get(diskDocs).get(key)).toBe("a");
  });

  it("marks the file clean when nothing changed during the write", async () => {
    vi.mocked(readTextFileAt).mockResolvedValue(file(""));
    await loadFileText(key);
    vi.mocked(writeTextFileAt).mockResolvedValue(saved());
    setDoc(key, "a");
    await saveActiveFile();
    expect(get(docs).has(key)).toBe(false);
    expect(get(diskDocs).get(key)).toBe("a");
  });
});

describe("saving against the time the file was read at", () => {
  const noteKey = fileKey("/ws", "m.md");

  async function openLoaded(mtime: number) {
    openFiles.set([noteKey]);
    activeFile.set(noteKey);
    vi.mocked(readTextFileAt).mockResolvedValue(file("disk", mtime));
    await loadFileText(noteKey);
  }

  it("sends the time it read, then the time the last save reported", async () => {
    await openLoaded(100);
    vi.mocked(writeTextFileAt).mockResolvedValue(saved(150));
    setDoc(noteKey, "a");
    await saveActiveFile();
    setDoc(noteKey, "ab");
    await saveActiveFile();

    expect(vi.mocked(writeTextFileAt).mock.calls.map((c) => c[2])).toEqual([100, 150]);
  });

  it("saves a brand-new note without an expected time", async () => {
    const fresh = fileKey("/ws", "fresh.md");
    activeFile.set(fresh);
    vi.mocked(writeTextFileAt).mockResolvedValue(saved(5));
    setDoc(fresh, "fresh");
    await saveActiveFile();

    expect(writeTextFileAt).toHaveBeenCalledWith("/ws/fresh.md", "fresh", null);
  });

  it("keeps the edit and offers reload or keep-mine when the disk moved on", async () => {
    await openLoaded(100);
    vi.mocked(writeTextFileAt).mockResolvedValueOnce({ kind: "conflict", diskMtime: 300 });
    setDoc(noteKey, "mine");
    await saveActiveFile();

    expect(get(conflicts).has(noteKey)).toBe(true);
    expect(get(docs).get(noteKey)).toBe("mine");
    expect(get(diskDocs).get(noteKey)).toBe("disk");

    // Saving is refused while the conflict is open, then goes through once the
    // user keeps their version — expecting the time the disk now has.
    vi.mocked(writeTextFileAt).mockClear();
    await saveActiveFile();
    expect(writeTextFileAt).not.toHaveBeenCalled();

    keepMine(noteKey);
    vi.mocked(writeTextFileAt).mockResolvedValue(saved(301));
    await saveActiveFile();
    expect(writeTextFileAt).toHaveBeenCalledWith("/ws/m.md", "mine", 300);
    expect(get(docs).has(noteKey)).toBe(false);
  });

  it("writes a file fresh when the user keeps their version of one deleted on disk", async () => {
    await openLoaded(100);
    vi.mocked(writeTextFileAt).mockResolvedValueOnce({ kind: "conflict", diskMtime: null });
    setDoc(noteKey, "mine");
    await saveActiveFile();
    expect(get(conflicts).has(noteKey)).toBe(true);

    keepMine(noteKey);
    vi.mocked(writeTextFileAt).mockResolvedValue(saved(400));
    await saveActiveFile();
    expect(writeTextFileAt).toHaveBeenLastCalledWith("/ws/m.md", "mine", null);
  });

  it("does not mistake a touch, or the echo of its own save, for someone else's edit", async () => {
    await openLoaded(100);
    // The watcher reports the same text with a newer time.
    vi.mocked(readTextFileAt).mockResolvedValue(file("disk", 180));
    await handleExternalChange("/ws", "m.md");
    vi.mocked(writeTextFileAt).mockResolvedValue(saved(190));
    setDoc(noteKey, "a");
    await saveActiveFile();

    expect(writeTextFileAt).toHaveBeenCalledWith("/ws/m.md", "a", 180);
    expect(get(conflicts).size).toBe(0);
  });
});

describe("external changes to an open file", () => {
  const ws = "/ws";
  const noteKey = fileKey(ws, "a.md");

  async function openLoaded(disk: string) {
    openFiles.set([noteKey]);
    activeFile.set(noteKey);
    vi.mocked(readTextFileAt).mockResolvedValue(file(disk));
    await loadFileText(noteKey);
    vi.mocked(readTextFileAt).mockClear();
  }

  it("reloads a clean file when it changes on disk", async () => {
    await openLoaded("old");
    vi.mocked(readTextFileAt).mockResolvedValue(file("new"));
    await handleExternalChange(ws, "a.md");
    expect(get(diskDocs).get(noteKey)).toBe("new");
    expect(get(conflicts).size).toBe(0);
  });

  it("flags a conflict instead of overwriting unsaved edits", async () => {
    await openLoaded("old");
    setDoc(noteKey, "mine");
    vi.mocked(readTextFileAt).mockResolvedValue(file("theirs"));
    await handleExternalChange(ws, "a.md");
    expect(get(docs).get(noteKey)).toBe("mine");
    expect(get(conflicts).has(noteKey)).toBe(true);

    await saveActiveFile();
    expect(writeTextFileAt).not.toHaveBeenCalled();
  });

  it("ignores the echo of its own save", async () => {
    await openLoaded("old");
    setDoc(noteKey, "mine");
    vi.mocked(writeTextFileAt).mockResolvedValue(saved());
    await saveActiveFile();
    setDoc(noteKey, "mine and more");
    vi.mocked(readTextFileAt).mockResolvedValue(file("mine"));
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
    vi.mocked(readTextFileAt).mockResolvedValue(file("theirs", 200));
    await handleExternalChange(ws, "a.md");

    keepMine(noteKey);
    vi.mocked(writeTextFileAt).mockResolvedValue(saved());
    await saveActiveFile();
    expect(writeTextFileAt).toHaveBeenCalledWith("/ws/a.md", "mine", 200);

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
    vi.mocked(readTextFileAt).mockResolvedValue(file("disk"));
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
    vi.mocked(writeTextFileAt).mockResolvedValue(saved());
    await resolveCloseRequest("save");
    expect(writeTextFileAt).toHaveBeenLastCalledWith("/ws/n.md", "typed", 1);
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

    vi.mocked(listWorkspaceDocs).mockResolvedValueOnce({ entries: [], truncated: false });
    await loadDocs("/ws");
    expect(get(listError)).toBe("");
  });
});

describe("registered folder listings", () => {
  it("remembers which folders the backend cut short", async () => {
    const entry = (name: string) => ({
      name,
      path: `/src/${name}`,
      is_dir: false,
      is_text: true,
    });
    vi.mocked(listDir)
      .mockResolvedValueOnce({ entries: [entry("a.md")], truncated: true })
      .mockResolvedValueOnce({ entries: [entry("b.md")], truncated: false });

    await loadSourceFiles(["/big", "/small"]);

    expect([...get(truncatedSources)]).toEqual(["/big"]);
  });
});
