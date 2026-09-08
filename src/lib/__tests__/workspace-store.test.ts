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
  removedWorkspaces,
  visibleWorkspaces,
  hideWorkspace,
  unhideWorkspace,
  activeWorkspacePath,
  activeSessionId,
  addWorkspace,
  addSession,
  removeSession,
  loadWorkspaces,
  resumeSession,
  nextAvailableColor,
  WORKSPACE_COLORS,
} from "../stores/workspace";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

describe("workspace store", () => {
  beforeEach(() => {
    workspaces.set([]);
    removedWorkspaces.set([]);
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

    it("names a Windows backslash path from its last segment", async () => {
      await addWorkspace("C:\\Users\\jake\\Documents\\GitHub\\Atlas");
      expect(get(workspaces)[0].name).toBe("Atlas");
    });

    it("names a mixed-separator path from its last segment", async () => {
      await addWorkspace("C:/Users/jake\\projects\\my-app");
      expect(get(workspaces)[0].name).toBe("my-app");
    });

    it("assigns colours from the six-colour palette", async () => {
      for (let i = 0; i < 6; i++) await addWorkspace(`/ws-${i}`);
      expect(get(workspaces).map((w) => w.color)).toEqual(WORKSPACE_COLORS);
    });
  });

  describe("nextAvailableColor", () => {
    it("returns the first unused palette colour", () => {
      const taken = WORKSPACE_COLORS.slice(0, 2).map((color) => ({
        path: color,
        name: color,
        color,
        sessions: [],
      }));
      expect(nextAvailableColor(taken)).toBe(WORKSPACE_COLORS[2]);
    });

    it("repeats from the top once all six are taken", () => {
      const taken = WORKSPACE_COLORS.map((color) => ({
        path: color,
        name: color,
        color,
        sessions: [],
      }));
      expect(nextAvailableColor(taken)).toBe(WORKSPACE_COLORS[0]);
    });
  });

  describe("addSession", () => {
    it("creates session with formatted label", async () => {
      await addWorkspace("/Users/jake/my-project");
      await addSession("/Users/jake/my-project", "my-project", "tab-1", "claude-1");
      const ws = get(workspaces);
      expect(ws[0].sessions).toHaveLength(1);
      expect(ws[0].sessions[0].label).toBe("My Project");
    });

    it("prepends to workspace sessions array", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1", "claude-1");
      await addSession("/a", "second", "tab-2", "claude-2");
      const ws = get(workspaces);
      expect(ws[0].sessions).toHaveLength(2);
      // Most recent session should be first
      expect(ws[0].sessions[0].label).toBe("Second");
    });

    it("sets activeSessionId", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1");
      expect(get(activeSessionId)).toBeTruthy();
    });

    it("stores the claude session id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1");
      expect(get(workspaces)[0].sessions[0].claudeSessionId).toBe("claude-1");
    });

    it("stores a null claude session id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", null);
      expect(get(workspaces)[0].sessions[0].claudeSessionId).toBeNull();
    });
  });

  describe("resumeSession", () => {
    it("reattaches the tab and records the claude session id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", null);
      const sessionId = get(workspaces)[0].sessions[0].id;
      await resumeSession(sessionId, "tab-2", "claude-9");
      const session = get(workspaces)[0].sessions[0];
      expect(session.status).toBe("running");
      expect(session.terminalTabId).toBe("tab-2");
      expect(session.claudeSessionId).toBe("claude-9");
    });
  });

  describe("removeSession", () => {
    it("removes session from workspace", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1");
      const sessionId = get(workspaces)[0].sessions[0].id;
      await removeSession("/a", sessionId);
      expect(get(workspaces)[0].sessions).toHaveLength(0);
    });

    it("clears activeSessionId if it matches", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1");
      const sessionId = get(workspaces)[0].sessions[0].id;
      activeSessionId.set(sessionId);
      await removeSession("/a", sessionId);
      expect(get(activeSessionId)).toBe("");
    });

    it("does not clear activeSessionId if it does not match", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1", "claude-1");
      await addSession("/a", "second", "tab-2", "claude-2");
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
            color: "#e67e80",
            sessions: [
              { id: "s1", label: "S1", status: "running", terminalTabId: null, createdAt: "", claudeSessionId: "claude-1" },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      const ws = get(workspaces);
      expect(ws).toHaveLength(1);
      expect(ws[0].sessions[0].status).toBe("idle");
    });

    it("preserves claudeSessionId across a reload", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify([
          {
            path: "/a",
            name: "a",
            color: "#e67e80",
            sessions: [
              { id: "s1", label: "S1", status: "running", terminalTabId: "tab-1", createdAt: "", claudeSessionId: "claude-1" },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      const session = get(workspaces)[0].sessions[0];
      expect(session.claudeSessionId).toBe("claude-1");
      expect(session.terminalTabId).toBeNull();
    });

    it("migrates sessions written without claudeSessionId to null", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify([
          {
            path: "/a",
            name: "a",
            color: "#e67e80",
            sessions: [
              { id: "s1", label: "S1", status: "idle", terminalTabId: null, createdAt: "" },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      expect(get(workspaces)[0].sessions[0].claudeSessionId).toBeNull();
    });

    it("migrates a retired Everforest colour onto the new palette", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify([
          { path: "/a", name: "a", color: "#e67e80", sessions: [] },
          { path: "/b", name: "b", color: "#a7c080", sessions: [] },
        ]),
      );
      await loadWorkspaces();
      const colours = get(workspaces).map((w) => w.color);
      expect(colours).toEqual([WORKSPACE_COLORS[0], WORKSPACE_COLORS[1]]);
    });

    it("keeps a colour that is already in the palette", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify([{ path: "/a", name: "a", color: WORKSPACE_COLORS[3], sessions: [] }]),
      );
      await loadWorkspaces();
      expect(get(workspaces)[0].color).toBe(WORKSPACE_COLORS[3]);
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

  describe("hideWorkspace / unhideWorkspace", () => {
    it("drops a hidden workspace from visibleWorkspaces but keeps it in workspaces", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      await hideWorkspace("/a");

      expect(get(visibleWorkspaces).map((w) => w.path)).toEqual(["/b"]);
      expect(get(workspaces).map((w) => w.path)).toEqual(["/a", "/b"]);
    });

    it("keeps a hidden workspace's sessions in the store", async () => {
      await addWorkspace("/a");
      await addSession("/a", "work", "tab-1", "claude-1");
      await hideWorkspace("/a");

      const ws = get(workspaces).find((w) => w.path === "/a");
      expect(ws?.sessions).toHaveLength(1);
      expect(ws?.sessions[0].terminalTabId).toBe("tab-1");
    });

    it("restores an unhidden workspace in its original position", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      await addWorkspace("/c");

      await hideWorkspace("/b");
      expect(get(visibleWorkspaces).map((w) => w.path)).toEqual(["/a", "/c"]);

      await unhideWorkspace("/b");
      expect(get(visibleWorkspaces).map((w) => w.path)).toEqual(["/a", "/b", "/c"]);
    });

    it("is a no-op when the workspace is already hidden", async () => {
      await addWorkspace("/a");
      await hideWorkspace("/a");
      vi.mocked(writeTextFile).mockClear();

      await hideWorkspace("/a");
      expect(get(removedWorkspaces)).toEqual(["/a"]);
      expect(writeTextFile).not.toHaveBeenCalled();
    });

    it("is a no-op when unhiding a workspace that is not hidden", async () => {
      await addWorkspace("/a");
      vi.mocked(writeTextFile).mockClear();

      await unhideWorkspace("/a");
      expect(get(removedWorkspaces)).toEqual([]);
      expect(writeTextFile).not.toHaveBeenCalled();
    });

    it("persists a hide and reloads it", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      await hideWorkspace("/a");

      const calls = vi.mocked(writeTextFile).mock.calls;
      const written = calls[calls.length - 1][1] as string;
      expect(JSON.parse(written).removedWorkspaces).toEqual(["/a"]);

      workspaces.set([]);
      removedWorkspaces.set([]);
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(written);
      await loadWorkspaces();

      expect(get(removedWorkspaces)).toEqual(["/a"]);
      expect(get(visibleWorkspaces).map((w) => w.path)).toEqual(["/b"]);
      expect(get(workspaces)).toHaveLength(2);
    });

    it("reads a legacy bare-array file as nothing hidden", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify([{ path: "/a", name: "a", color: WORKSPACE_COLORS[0], sessions: [] }]),
      );
      await loadWorkspaces();

      expect(get(removedWorkspaces)).toEqual([]);
      expect(get(visibleWorkspaces)).toHaveLength(1);
    });
  });
});
