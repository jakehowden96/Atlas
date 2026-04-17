import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../stores/terminal", () => ({
  switchToTab: vi.fn(),
  cycleTab: vi.fn(),
}));
vi.mock("../stores/panel", () => ({
  togglePanel: vi.fn(),
  setSection: vi.fn(),
  panelData: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));
vi.mock("../stores/workspace", () => ({
  cycleWorkspace: vi.fn(),
  activeWorkspacePath: { subscribe: vi.fn(() => () => {}) },
  workspaces: { subscribe: vi.fn(() => () => {}) },
}));
vi.mock("../file-open", () => ({
  openFile: vi.fn(),
}));
vi.mock("../file-save", () => ({
  saveActiveFile: vi.fn(),
}));

import { handleGlobalKeydown, setRefreshHandler } from "../shortcuts";
import { switchToTab, cycleTab } from "../stores/terminal";
import { togglePanel, setSection } from "../stores/panel";
import { cycleWorkspace } from "../stores/workspace";
import { openFile } from "../file-open";
import { saveActiveFile } from "../file-save";

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const e = {
    ctrlKey: false,
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
    setRefreshHandler(null as unknown as () => void);
  });

  it("Ctrl+O opens file", () => {
    const e = makeKeyEvent({ ctrlKey: true, key: "o" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(openFile).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Ctrl+S saves active file", () => {
    const e = makeKeyEvent({ ctrlKey: true, key: "s" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(saveActiveFile).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Ctrl+Tab cycles tab forward", () => {
    const e = makeKeyEvent({ ctrlKey: true, key: "Tab" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(cycleTab).toHaveBeenCalledWith(1);
  });

  it("Ctrl+Shift+Tab cycles tab backward", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "Tab" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(cycleTab).toHaveBeenCalledWith(-1);
  });

  it("Ctrl+1 through Ctrl+9 switches to tab index", () => {
    for (let n = 1; n <= 9; n++) {
      vi.clearAllMocks();
      const e = makeKeyEvent({ ctrlKey: true, key: String(n) });
      const handled = handleGlobalKeydown(e);
      expect(handled).toBe(true);
      expect(switchToTab).toHaveBeenCalledWith(n - 1);
    }
  });

  it("Ctrl+Shift+\\ toggles panel", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "\\" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(togglePanel).toHaveBeenCalled();
  });

  it("Ctrl+Shift+D shows diff section", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "D" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(setSection).toHaveBeenCalledWith("diff");
  });

  it("Ctrl+Shift+S shows summary section", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "S" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(setSection).toHaveBeenCalledWith("summary");
  });

  it("Ctrl+Shift+F shows flow section", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "F" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(setSection).toHaveBeenCalledWith("flow");
  });

  it("Ctrl+Shift+R calls refresh handler when set", () => {
    const handler = vi.fn();
    setRefreshHandler(handler);
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "R" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("Ctrl+Shift+[ cycles workspace backward", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "[" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(cycleWorkspace).toHaveBeenCalledWith(-1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Ctrl+Shift+] cycles workspace forward", () => {
    const e = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "]" });
    const handled = handleGlobalKeydown(e);
    expect(handled).toBe(true);
    expect(cycleWorkspace).toHaveBeenCalledWith(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("returns false for unhandled keys", () => {
    const e = makeKeyEvent({ key: "a" });
    expect(handleGlobalKeydown(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
