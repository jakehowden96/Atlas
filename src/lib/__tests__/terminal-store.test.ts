import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../stores/panel", () => ({
  panelData: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
  panelVisible: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
  activeSection: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
  apiKeyConfigured: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
  analysisStatus: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
  analysisError: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

import {
  tabs,
  activeTabId,
  addTab,
  removeTab,
  switchToTab,
  cycleTab,
  setTabTitle,
  setTabReady,
  setTabNeedsInput,
  getTabsByWorkspace,
  getTabWorkspacePath,
  activeWorkspaceTabs,
  lastActiveTabByWorkspace,
} from "../stores/terminal";
import { activeWorkspacePath } from "../stores/workspace";
import { panelData } from "../stores/panel";
import type { TabItem } from "../../types/terminal";

function makeTerminalTab(overrides: Partial<TabItem & { type: "terminal" }> = {}): TabItem {
  return {
    type: "terminal",
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "",
    ptyId: -1,
    terminal: {} as any,
    ...overrides,
  };
}

function makeMarkdownTab(overrides: Partial<TabItem & { type: "markdown" }> = {}): TabItem {
  return {
    type: "markdown",
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "",
    content: "",
    ...overrides,
  };
}

describe("terminal store", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
    activeWorkspacePath.set("");
    lastActiveTabByWorkspace.set(new Map());
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  describe("addTab", () => {
    it("adds a tab and sets it as active", () => {
      const tab = makeTerminalTab({ id: "t1" });
      addTab(tab);
      expect(get(tabs)).toHaveLength(1);
      expect(get(activeTabId)).toBe("t1");
    });

    it("appends to existing tabs", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      expect(get(tabs)).toHaveLength(2);
      expect(get(activeTabId)).toBe("t2");
    });
  });

  describe("addTab — standalone terminal (no workspace)", () => {
    it("creates a valid tab without cwd", () => {
      const tab = makeTerminalTab({ id: "standalone", title: "Terminal" });
      addTab(tab);
      const t = get(tabs);
      expect(t).toHaveLength(1);
      expect(t[0].type).toBe("terminal");
      expect(t[0].title).toBe("Terminal");
      expect(get(activeTabId)).toBe("standalone");
      // cwd is not set — tab works but panel won't refresh until OSC 7
      if (t[0].type === "terminal") {
        expect(t[0].cwd).toBeUndefined();
      }
    });
  });

  describe("removeTab", () => {
    it("removes the specified tab", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      removeTab("t1");
      expect(get(tabs)).toHaveLength(1);
      expect(get(tabs)[0].id).toBe("t2");
    });

    it("sets the last remaining tab as active", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      addTab(makeTerminalTab({ id: "t3" }));
      removeTab("t3");
      expect(get(activeTabId)).toBe("t2");
    });

    it("sets activeTabId to empty when no tabs remain", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      removeTab("t1");
      expect(get(tabs)).toHaveLength(0);
      expect(get(activeTabId)).toBe("");
    });

    it("clears panelData when removing the active tab", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      removeTab("t1");
      expect(panelData.set).toHaveBeenCalledWith(null);
    });

    it("does not clear panelData when removing a non-active tab", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      removeTab("t1");
      expect(panelData.set).not.toHaveBeenCalledWith(null);
    });

    it("falls back to another tab in the same workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/b" }));
      activeTabId.set("t2");
      removeTab("t2");
      expect(get(activeTabId)).toBe("t1");
    });

    it("falls back to any remaining tab when same-workspace tabs exhausted", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/b" }));
      activeTabId.set("t1");
      removeTab("t1");
      expect(get(activeTabId)).toBe("t2");
    });

    it("syncs activeWorkspacePath when falling back to cross-workspace tab", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/b" }));
      activeWorkspacePath.set("/a");
      activeTabId.set("t1");
      removeTab("t1");
      expect(get(activeTabId)).toBe("t2");
      expect(get(activeWorkspacePath)).toBe("/b");
    });
  });

  describe("switchToTab", () => {
    it("switches to tab at valid index within active workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/b" }));
      activeWorkspacePath.set("/a");
      switchToTab(0);
      expect(get(activeTabId)).toBe("t1");
    });

    it("indexes within workspace-scoped tabs only", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/b" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/b" }));
      activeWorkspacePath.set("/b");
      switchToTab(0);
      expect(get(activeTabId)).toBe("t2");
      switchToTab(1);
      expect(get(activeTabId)).toBe("t3");
    });

    it("ignores negative index", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      switchToTab(-1);
      expect(get(activeTabId)).toBe("t1");
    });

    it("ignores out-of-bounds index", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      switchToTab(5);
      expect(get(activeTabId)).toBe("t1");
    });
  });

  describe("cycleTab", () => {
    it("cycles forward within active workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/b" }));
      activeWorkspacePath.set("/a");
      activeTabId.set("t1");
      cycleTab(1);
      expect(get(activeTabId)).toBe("t2");
    });

    it("cycles backward within active workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      activeWorkspacePath.set("/a");
      activeTabId.set("t2");
      cycleTab(-1);
      expect(get(activeTabId)).toBe("t1");
    });

    it("wraps around from last to first", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      activeWorkspacePath.set("/a");
      activeTabId.set("t2");
      cycleTab(1);
      expect(get(activeTabId)).toBe("t1");
    });

    it("wraps around from first to last", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      activeWorkspacePath.set("/a");
      activeTabId.set("t1");
      cycleTab(-1);
      expect(get(activeTabId)).toBe("t2");
    });

    it("no-op when active workspace has fewer than 2 tabs", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/b" }));
      activeWorkspacePath.set("/a");
      activeTabId.set("t1");
      cycleTab(1);
      expect(get(activeTabId)).toBe("t1");
    });
  });

  describe("setTabTitle", () => {
    it("debounces title updates", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      setTabTitle("t1", "New Title");
      // Not updated yet (debounced 100ms)
      expect(get(tabs)[0].title).toBe("");
      vi.advanceTimersByTime(100);
      expect(get(tabs)[0].title).toBe("New Title");
    });

    it("cancels previous pending update", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      setTabTitle("t1", "First");
      vi.advanceTimersByTime(50);
      setTabTitle("t1", "Second");
      vi.advanceTimersByTime(100);
      expect(get(tabs)[0].title).toBe("Second");
    });
  });

  describe("setTabReady", () => {
    it("sets ready flag on terminal tab", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      setTabReady("t1");
      const tab = get(tabs)[0];
      expect(tab.type === "terminal" && tab.ready).toBe(true);
    });
  });

  describe("setTabNeedsInput", () => {
    it("sets needsInput flag", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      setTabNeedsInput("t1", true);
      const tab = get(tabs)[0];
      expect(tab.type === "terminal" && tab.needsInput).toBe(true);
    });

    it("no-op if value unchanged", () => {
      const spy = vi.fn();
      addTab(makeTerminalTab({ id: "t1" }));
      setTabNeedsInput("t1", true);
      tabs.subscribe(spy);
      const callCount = spy.mock.calls.length;
      setTabNeedsInput("t1", true);
      expect(spy.mock.calls.length).toBe(callCount);
    });
  });

  describe("getTabsByWorkspace", () => {
    it("groups tabs by cwd", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/b" }));
      const groups = getTabsByWorkspace();
      expect(groups.get("/a")).toHaveLength(2);
      expect(groups.get("/b")).toHaveLength(1);
    });

    it("puts tabs without cwd under empty string key", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      const groups = getTabsByWorkspace();
      expect(groups.get("")).toHaveLength(1);
    });
  });

  describe("getTabWorkspacePath", () => {
    it("returns cwd for terminal tabs", () => {
      const tab = makeTerminalTab({ cwd: "/a" });
      expect(getTabWorkspacePath(tab)).toBe("/a");
    });

    it("returns empty string for terminal tabs without cwd", () => {
      const tab = makeTerminalTab({});
      expect(getTabWorkspacePath(tab)).toBe("");
    });

    it("returns workspacePath for markdown tabs", () => {
      const tab = makeMarkdownTab({ workspacePath: "/a" } as any);
      expect(getTabWorkspacePath(tab)).toBe("/a");
    });

    it("returns empty string for markdown tabs without workspacePath", () => {
      const tab = makeMarkdownTab({});
      expect(getTabWorkspacePath(tab)).toBe("");
    });
  });

  describe("activeWorkspaceTabs", () => {
    it("filters tabs by active workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/b" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/a" }));
      activeWorkspacePath.set("/a");
      const filtered = get(activeWorkspaceTabs);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.id)).toEqual(["t1", "t3"]);
    });

    it("returns only ungrouped tabs when no workspace is active", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2" }));
      activeWorkspacePath.set("");
      const filtered = get(activeWorkspaceTabs);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("t2");
    });
  });

  describe("lastActiveTabByWorkspace", () => {
    it("tracks last active tab per workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/b" }));
      activeTabId.set("t1");
      activeTabId.set("t2");
      const map = get(lastActiveTabByWorkspace);
      expect(map.get("/a")).toBe("t1");
      expect(map.get("/b")).toBe("t2");
    });

    it("does not track tabs without workspace", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      activeTabId.set("t1");
      const map = get(lastActiveTabByWorkspace);
      expect(map.has("")).toBe(false);
    });
  });

  describe("workspace switch tab restoration", () => {
    it("restores last active tab when switching workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t3", cwd: "/b" }));
      // Visit t2 in workspace /a, then switch to /b
      activeTabId.set("t2");
      activeWorkspacePath.set("/b");
      expect(get(activeTabId)).toBe("t3");
      // Switch back to /a — should restore t2
      activeWorkspacePath.set("/a");
      expect(get(activeTabId)).toBe("t2");
    });

    it("falls back to first tab when no history for workspace", () => {
      // Add tabs without triggering lastActiveTabByWorkspace for /b
      // by adding only one tab per workspace
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      activeTabId.set("t1");
      // Manually add a tab to /b without making it active
      tabs.update((t) => [...t, { type: "terminal" as const, id: "t2", title: "", ptyId: -1, terminal: {} as any, cwd: "/b" }]);
      activeWorkspacePath.set("/b");
      expect(get(activeTabId)).toBe("t2");
    });

    it("keeps active tab when it already belongs to the new workspace", () => {
      addTab(makeTerminalTab({ id: "t1", cwd: "/a" }));
      addTab(makeTerminalTab({ id: "t2", cwd: "/a" }));
      activeTabId.set("t2");
      activeWorkspacePath.set("/a");
      expect(get(activeTabId)).toBe("t2");
    });
  });
});
