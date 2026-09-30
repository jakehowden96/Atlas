import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../stores/panel", () => ({
  panelData: { set: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));

import {
  tabs,
  activeTabId,
  addTab,
  removeTab,
  setTabReady,
  setTabNeedsInput,
  awaitTabPty,
} from "../stores/terminal";
import { activeWorkspacePath } from "../stores/workspace";
import { panelData } from "../stores/panel";
import type { TabItem } from "../../types/terminal";

function makeTerminalTab(overrides: Partial<TabItem> = {}): TabItem {
  return {
    type: "terminal",
    id: overrides.id ?? crypto.randomUUID(),
    ptyId: -1,
    ...overrides,
  };
}

describe("terminal store", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
    activeWorkspacePath.set("");
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

  describe("setTabReady", () => {
    it("sets ready flag on terminal tab", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      setTabReady("t1");
      expect(get(tabs)[0].ready).toBe(true);
    });
  });

  describe("awaitTabPty", () => {
    it("resolves as soon as the pty id lands on the tab", async () => {
      addTab(makeTerminalTab({ id: "t1" }));
      const pending = awaitTabPty("t1");
      tabs.update((t) => t.map((x) => (x.id === "t1" ? { ...x, ptyId: 7 } : x)));
      await expect(pending).resolves.toMatchObject({ id: "t1", ptyId: 7 });
    });

    it("resolves immediately when the tab already has a pty", async () => {
      addTab(makeTerminalTab({ id: "t1", ptyId: 3 }));
      await expect(awaitTabPty("t1")).resolves.toMatchObject({ ptyId: 3 });
    });

    it("resolves null when the tab is closed before its pty arrives", async () => {
      addTab(makeTerminalTab({ id: "t1" }));
      const pending = awaitTabPty("t1");
      removeTab("t1");
      await expect(pending).resolves.toBeNull();
    });

    it("resolves null for a tab that never spawns", async () => {
      addTab(makeTerminalTab({ id: "t1" }));
      const pending = awaitTabPty("t1", 10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBeNull();
    });

    it("stops listening once settled, so later updates are ignored", async () => {
      addTab(makeTerminalTab({ id: "t1" }));
      const pending = awaitTabPty("t1");
      tabs.update((t) => t.map((x) => (x.id === "t1" ? { ...x, ptyId: 7 } : x)));
      await expect(pending).resolves.toMatchObject({ ptyId: 7 });
      // A settled promise must not be re-resolved by a subsequent change.
      removeTab("t1");
      await expect(pending).resolves.toMatchObject({ ptyId: 7 });
    });
  });

  describe("setTabNeedsInput", () => {
    it("sets needsInput flag", () => {
      addTab(makeTerminalTab({ id: "t1" }));
      setTabNeedsInput("t1", true);
      expect(get(tabs)[0].needsInput).toBe(true);
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
});
