import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

import {
  workspaces,
  activeWorkspacePath,
  activeSessionId,
  addWorkspace,
  addSession,
  removeSession,
  loadWorkspaces,
  cycleWorkspace,
  updateSessionDiffStatsByTabId,
} from "../stores/workspace";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";

describe("workspace store", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspacePath.set("");
    activeSessionId.set("");
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  describe("addWorkspace", () => {
    it("adds workspace with correct name extracted from path", async () => {
      const result = await addWorkspace("/Users/jake/projects/my-app");
      expect(result).toBe(true);
      const ws = get(workspaces);
      expect(ws).toHaveLength(1);
      expect(ws[0].name).toBe("my-app");
      expect(ws[0].path).toBe("/Users/jake/projects/my-app");
    });

    it("assigns a color to the workspace", async () => {
      await addWorkspace("/a");
      const ws = get(workspaces);
      expect(ws[0].color).toBeTruthy();
    });

    it("does not add duplicate paths", async () => {
      await addWorkspace("/a");
      const result = await addWorkspace("/a");
      expect(result).toBe(false);
      expect(get(workspaces)).toHaveLength(1);
    });

    it("sets activeWorkspacePath", async () => {
      await addWorkspace("/a");
      expect(get(activeWorkspacePath)).toBe("/a");
    });
  });

  describe("addSession", () => {
    it("creates session with formatted label", async () => {
      await addWorkspace("/Users/jake/my-project");
      await addSession("/Users/jake/my-project", "my-project", "tab-1");
      const ws = get(workspaces);
      expect(ws[0].sessions).toHaveLength(1);
      expect(ws[0].sessions[0].label).toBe("My Project");
    });

    it("prepends to workspace sessions array", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1");
      await addSession("/a", "second", "tab-2");
      const ws = get(workspaces);
      expect(ws[0].sessions).toHaveLength(2);
      // Most recent session should be first
      expect(ws[0].sessions[0].label).toBe("Second");
    });

    it("sets activeSessionId", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1");
      expect(get(activeSessionId)).toBeTruthy();
    });
  });

  describe("removeSession", () => {
    it("removes session from workspace", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1");
      const sessionId = get(workspaces)[0].sessions[0].id;
      await removeSession("/a", sessionId);
      expect(get(workspaces)[0].sessions).toHaveLength(0);
    });

    it("clears activeSessionId if it matches", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1");
      const sessionId = get(workspaces)[0].sessions[0].id;
      activeSessionId.set(sessionId);
      await removeSession("/a", sessionId);
      expect(get(activeSessionId)).toBe("");
    });

    it("does not clear activeSessionId if it does not match", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1");
      await addSession("/a", "second", "tab-2");
      const sessions = get(workspaces)[0].sessions;
      activeSessionId.set(sessions[0].id);
      await removeSession("/a", sessions[1].id);
      expect(get(activeSessionId)).toBe(sessions[0].id);
    });
  });

  describe("updateSessionDiffStatsByTabId", () => {
    it("updates diffStats for the session whose terminalTabId matches", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1");
      await addSession("/a", "second", "tab-2");
      updateSessionDiffStatsByTabId("tab-2", { files: 3, added: 12, removed: 5 });
      const sessions = get(workspaces)[0].sessions;
      const tab2Session = sessions.find((s) => s.terminalTabId === "tab-2");
      const tab1Session = sessions.find((s) => s.terminalTabId === "tab-1");
      expect(tab2Session?.diffStats).toEqual({ files: 3, added: 12, removed: 5 });
      expect(tab1Session?.diffStats).toBeUndefined();
    });

    it("does not persist diffStats to disk", async () => {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1");
      vi.mocked(writeTextFile).mockClear();
      updateSessionDiffStatsByTabId("tab-1", { files: 1, added: 2, removed: 3 });
      // updateSessionDiffStatsByTabId is in-memory only.
      expect(writeTextFile).not.toHaveBeenCalled();
    });
  });

  describe("cycleWorkspace", () => {
    it("cycles forward", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      activeWorkspacePath.set("/a");
      cycleWorkspace(1);
      expect(get(activeWorkspacePath)).toBe("/b");
    });

    it("cycles backward", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      activeWorkspacePath.set("/b");
      cycleWorkspace(-1);
      expect(get(activeWorkspacePath)).toBe("/a");
    });

    it("wraps around forward", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      activeWorkspacePath.set("/b");
      cycleWorkspace(1);
      expect(get(activeWorkspacePath)).toBe("/a");
    });

    it("wraps around backward", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      activeWorkspacePath.set("/a");
      cycleWorkspace(-1);
      expect(get(activeWorkspacePath)).toBe("/b");
    });

    it("no-op with fewer than 2 workspaces", async () => {
      await addWorkspace("/a");
      activeWorkspacePath.set("/a");
      cycleWorkspace(1);
      expect(get(activeWorkspacePath)).toBe("/a");
    });
  });

  describe("loadWorkspaces", () => {
    it("loads from file and resets running sessions to idle", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify([
          {
            path: "/a",
            name: "a",
            color: "#fff",
            sessions: [
              { id: "s1", label: "S1", status: "running", age: "", toolSessionId: null, terminalTabId: null, createdAt: "" },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      const ws = get(workspaces);
      expect(ws).toHaveLength(1);
      expect(ws[0].sessions[0].status).toBe("idle");
    });

    it("handles missing file gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      await loadWorkspaces();
      expect(get(workspaces)).toEqual([]);
    });

    it("handles corrupted JSON gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("not json");
      await loadWorkspaces();
      expect(get(workspaces)).toEqual([]);
    });
  });
});
