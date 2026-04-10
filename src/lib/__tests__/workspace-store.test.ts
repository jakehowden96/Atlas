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
              { id: "s1", label: "S1", status: "running", age: "", claudeSessionId: null, terminalTabId: null, createdAt: "" },
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
