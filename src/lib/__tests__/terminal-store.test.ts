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
} from "../stores/terminal";
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

describe("terminal store", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
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
  });

  describe("switchToTab", () => {
    it("switches to tab at valid index", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      switchToTab(0);
      expect(get(activeTabId)).toBe("t1");
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
    it("cycles forward", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      addTab(makeTerminalTab({ id: "t3" }));
      activeTabId.set("t1");
      cycleTab(1);
      expect(get(activeTabId)).toBe("t2");
    });

    it("cycles backward", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      activeTabId.set("t2");
      cycleTab(-1);
      expect(get(activeTabId)).toBe("t1");
    });

    it("wraps around from last to first", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      activeTabId.set("t2");
      cycleTab(1);
      expect(get(activeTabId)).toBe("t1");
    });

    it("wraps around from first to last", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      addTab(makeTerminalTab({ id: "t2" }));
      activeTabId.set("t1");
      cycleTab(-1);
      expect(get(activeTabId)).toBe("t2");
    });

    it("no-op with fewer than 2 tabs", () => {
      addTab(makeTerminalTab({ id: "t1" }));
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
});
