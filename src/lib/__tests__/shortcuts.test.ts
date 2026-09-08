import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

import { handleGlobalKeydown } from "../shortcuts";
import { settingsOpen } from "../stores/settings";
import { activeView, diffOpen, jumpOpen, newSessionOpen, railOpen } from "../stores/view";

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
    activeView.set("overview");
    diffOpen.set(false);
    railOpen.set(true);
    newSessionOpen.set(false);
    jumpOpen.set(false);
    settingsOpen.set(false);
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

  it("Esc returns Session view to Overview once nothing else is open", () => {
    activeView.set("session");
    expect(handleGlobalKeydown(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(get(activeView)).toBe("overview");
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
});
