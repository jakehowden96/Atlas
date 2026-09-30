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
vi.mock("../stores/toast", () => ({ showToast: vi.fn() }));

import { readTextFileAt, writeTextFileAt } from "../ipc";
import { fileKey } from "../files";
import {
  activeFile,
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
