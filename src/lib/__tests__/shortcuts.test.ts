import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

vi.mock("../ipc", () => ({
  listClaudePlans: vi.fn(),
  listDir: vi.fn(),
  listWorkspaceDocs: vi.fn(),
  readTextFileAt: vi.fn(),
  writeTextFileAt: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
}));

import { fileKey } from "../files";
import { writeTextFileAt } from "../ipc";
import { DEFAULT_KEYMAP } from "../keymap";
import { handleGlobalKeydown } from "../shortcuts";
import { activeFile, docs, setDoc } from "../stores/files";
import { keymap, settingsOpen } from "../stores/settings";
import {
  activeView,
  diffOpen,
  jumpOpen,
  newSessionOpen,
  openDialogOpen,
  railOpen,
} from "../stores/view";

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const e = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: "",
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
  return e;
}

describe("handleGlobalKeydown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeView.set("sessions");
    diffOpen.set(false);
    railOpen.set(true);
    newSessionOpen.set(false);
    jumpOpen.set(false);
    openDialogOpen.set(false);
    settingsOpen.set(false);
    activeFile.set("");
    docs.set(new Map());
    keymap.set({ ...DEFAULT_KEYMAP });
  });

  it("⌘S saves the active file on the Files view", async () => {
    const key = fileKey("/ws", "notes.md");
    activeView.set("files");
    activeFile.set(key);
    setDoc(key, "edited");
    const e = makeKeyEvent({ metaKey: true, key: "s" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(writeTextFileAt).toHaveBeenCalledWith("/ws/notes.md", "edited"));
  });

  it("⌘S is left unhandled on Sessions", () => {
    const key = fileKey("/ws", "notes.md");
    activeFile.set(key);
    setDoc(key, "edited");
    const e = makeKeyEvent({ metaKey: true, key: "s" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(writeTextFileAt).not.toHaveBeenCalled();
  });

  it("⌘O opens the Open… dialog on the Files view", () => {
    activeView.set("files");
    const e = makeKeyEvent({ metaKey: true, key: "o" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(openDialogOpen)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("⌘O is left unhandled on Sessions", () => {
    const e = makeKeyEvent({ metaKey: true, key: "o" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(get(openDialogOpen)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("Esc closes the Open… dialog before the new session modal", () => {
    openDialogOpen.set(true);
    newSessionOpen.set(true);
    expect(handleGlobalKeydown(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(get(openDialogOpen)).toBe(false);
    expect(get(newSessionOpen)).toBe(true);
  });

  it("⌘N opens the new session modal", () => {
    const e = makeKeyEvent({ metaKey: true, key: "n" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(newSessionOpen)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Ctrl+N opens the new session modal", () => {
    const e = makeKeyEvent({ ctrlKey: true, key: "n" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(newSessionOpen)).toBe(true);
  });

  it("⌘K opens the jump palette", () => {
    const e = makeKeyEvent({ metaKey: true, key: "k" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(jumpOpen)).toBe(true);
  });

  it("Ctrl+K opens the jump palette", () => {
    const e = makeKeyEvent({ ctrlKey: true, key: "k" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(jumpOpen)).toBe(true);
  });

  it("⌘, opens settings", () => {
    const e = makeKeyEvent({ metaKey: true, key: "," });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(settingsOpen)).toBe(true);
  });

  it("Ctrl+, opens settings", () => {
    const e = makeKeyEvent({ ctrlKey: true, key: "," });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(settingsOpen)).toBe(true);
  });

  it("⌘\\ toggles the activity rail", () => {
    const e = makeKeyEvent({ metaKey: true, key: "\\" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(railOpen)).toBe(false);
    handleGlobalKeydown(makeKeyEvent({ metaKey: true, key: "\\" }));
    expect(get(railOpen)).toBe(true);
  });

  it("Ctrl+Shift+\\ toggles the activity rail", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "\\" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(railOpen)).toBe(false);
  });

  it.each([
    ["Digit1", "sessions"],
    ["Digit2", "files"],
    ["Digit3", "prs"],
    ["Digit4", "stats"],
  ])("⌘%s switches to the %s tab", (code, view) => {
    activeView.set("session");
    const e = makeKeyEvent({ metaKey: true, key: code.slice(5), code });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(activeView)).toBe(view);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("⌘1 escapes Session view back to Sessions", () => {
    activeView.set("session");
    const e = makeKeyEvent({ metaKey: true, key: "1", code: "Digit1" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(activeView)).toBe("sessions");
  });

  it("⌘5 is left unhandled — there is no fifth tab", () => {
    activeView.set("stats");
    const e = makeKeyEvent({ metaKey: true, key: "5", code: "Digit5" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(get(activeView)).toBe("stats");
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("AltGr is left unhandled — it is Ctrl+Alt on a non-US layout", () => {
    activeView.set("stats");
    // `AltGr+2` types `@` on a German keyboard; it must not switch tabs.
    const digit = makeKeyEvent({ ctrlKey: true, altKey: true, key: "@", code: "Digit2" });
    expect(handleGlobalKeydown(digit)).toBe(false);
    expect(get(activeView)).toBe("stats");
    expect(digit.preventDefault).not.toHaveBeenCalled();

    // And `AltGr+ß` types `\`, which must not toggle the rail.
    const backslash = makeKeyEvent({ ctrlKey: true, altKey: true, key: "\\" });
    expect(handleGlobalKeydown(backslash)).toBe(false);
    expect(get(railOpen)).toBe(true);
  });

  it("Shift+⌘1 is left unhandled", () => {
    activeView.set("stats");
    const e = makeKeyEvent({ metaKey: true, shiftKey: true, key: "1", code: "Digit1" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(get(activeView)).toBe("stats");
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("Esc closes the jump palette before anything else", () => {
    jumpOpen.set(true);
    newSessionOpen.set(true);
    const e = makeKeyEvent({ key: "Escape" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(jumpOpen)).toBe(false);
    expect(get(newSessionOpen)).toBe(true);
  });

  it("Esc closes the new session modal before settings", () => {
    newSessionOpen.set(true);
    settingsOpen.set(true);
    expect(handleGlobalKeydown(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(get(newSessionOpen)).toBe(false);
    expect(get(settingsOpen)).toBe(true);
  });

  it("Esc closes settings", () => {
    settingsOpen.set(true);
    expect(handleGlobalKeydown(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(get(settingsOpen)).toBe(false);
  });

  it("Esc closes the changes drawer once no modal is open", () => {
    activeView.set("session");
    diffOpen.set(true);
    expect(handleGlobalKeydown(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(get(diffOpen)).toBe(false);
    expect(get(activeView)).toBe("session");
  });

  it("Esc returns Session view to Sessions once nothing else is open", () => {
    activeView.set("session");
    expect(handleGlobalKeydown(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(get(activeView)).toBe("sessions");
  });

  it("Esc is left unhandled when nothing is open", () => {
    const e = makeKeyEvent({ key: "Escape" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("returns false for unhandled keys", () => {
    const e = makeKeyEvent({ key: "a" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores unmodified letters that match a chord", () => {
    const e = makeKeyEvent({ key: "n" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(get(newSessionOpen)).toBe(false);
  });

  it("⌘Esc returns to Sessions from a session, where bare Esc is Claude's", () => {
    activeView.set("session");
    const e = makeKeyEvent({ metaKey: true, key: "Escape" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(activeView)).toBe("sessions");
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Ctrl+Esc returns to Sessions", () => {
    activeView.set("session");
    expect(handleGlobalKeydown(makeKeyEvent({ ctrlKey: true, key: "Escape" }))).toBe(true);
    expect(get(activeView)).toBe("sessions");
  });

  it("⌘Esc does not fall through to the modal ladder", () => {
    jumpOpen.set(true);
    activeView.set("session");
    expect(handleGlobalKeydown(makeKeyEvent({ metaKey: true, key: "Escape" }))).toBe(true);
    expect(get(jumpOpen)).toBe(true);
    expect(get(activeView)).toBe("sessions");
  });

  it("a rebound chord fires and the old one no longer does", () => {
    keymap.set({ ...DEFAULT_KEYMAP, jump: [{ mod: true, shift: false, key: "p" }] });

    const rebound = makeKeyEvent({ metaKey: true, key: "p" });
    expect(handleGlobalKeydown(rebound)).toBe(true);
    expect(get(jumpOpen)).toBe(true);

    jumpOpen.set(false);
    const old = makeKeyEvent({ metaKey: true, key: "k" });
    expect(handleGlobalKeydown(old)).toBe(false);
    expect(get(jumpOpen)).toBe(false);
    expect(old.preventDefault).not.toHaveBeenCalled();
  });

  it("a rebound tab chord matches the new digit's code", () => {
    keymap.set({ ...DEFAULT_KEYMAP, tab2: [{ mod: true, shift: false, key: "Digit8" }] });
    const e = makeKeyEvent({ metaKey: true, key: "8", code: "Digit8" });
    expect(handleGlobalKeydown(e)).toBe(true);
    expect(get(activeView)).toBe("files");
  });
});
