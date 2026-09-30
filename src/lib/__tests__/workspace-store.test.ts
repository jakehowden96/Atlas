import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({ stateLoad: vi.fn(), stateSave: vi.fn() }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** What the backend hands `loadWorkspaces` for a file that exists. */
function mockFile(contents: string) {
  vi.mocked(stateLoad).mockResolvedValue({ contents, recovered: false });
}

function mockNoFile() {
  vi.mocked(stateLoad).mockResolvedValue({ contents: null, recovered: false });
}

const OLD_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

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
  migrateWorkspaces,
  WORKSPACES_VERSION,
  resumeSession,
  rebindSessionClaudeId,
  nextAvailableColor,
  WORKSPACE_COLORS,
  type Workspace,
} from "../stores/workspace";
import { stateLoad, stateSave } from "../ipc";
import { toasts } from "../stores/toast";

describe("workspace store", () => {
  // Writes are held until the first load settles, so settle it once.
  beforeAll(async () => {
    mockNoFile();
    await loadWorkspaces();
  });

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
      expect(ws[0]!.name).toBe("my-app");
      expect(ws[0]!.path).toBe("/Users/jake/projects/my-app");
    });

    it("assigns a color to the workspace", async () => {
      await addWorkspace("/a");
      const ws = get(workspaces);
      expect(ws[0]!.color).toBeTruthy();
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
      expect(get(workspaces)[0]!.name).toBe("Atlas");
    });

    it("names a mixed-separator path from its last segment", async () => {
      await addWorkspace("C:/Users/jake\\projects\\my-app");
      expect(get(workspaces)[0]!.name).toBe("my-app");
    });

    it("assigns colours from the palette", async () => {
      for (let i = 0; i < WORKSPACE_COLORS.length; i++) await addWorkspace(`/ws-${i}`);
      expect(get(workspaces).map((w) => w.color)).toEqual(WORKSPACE_COLORS);
    });
  });

  describe("WORKSPACE_COLORS", () => {
    it("has no duplicates", () => {
      expect(new Set(WORKSPACE_COLORS).size).toBe(WORKSPACE_COLORS.length);
    });

    // loadWorkspaces re-tags any workspace whose colour is outside the palette,
    // so changing these six would silently re-colour every existing install.
    it("keeps the original six first, in order", () => {
      expect(WORKSPACE_COLORS.slice(0, 6)).toEqual([
        "#2fa37a",
        "#5b8def",
        "#7c6cf2",
        "#e0873a",
        "#d9455f",
        "#8a8f98",
      ]);
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

    it("hands out twelve distinct colours before repeating", () => {
      const taken: Workspace[] = [];
      for (let i = 0; i < 12; i++) {
        const color = nextAvailableColor(taken);
        taken.push({ path: `/ws-${i}`, name: `ws-${i}`, color, sessions: [] });
      }
      const colours = taken.map((w) => w.color);
      expect(new Set(colours).size).toBe(12);
      expect(nextAvailableColor(taken)).toBe(WORKSPACE_COLORS[0]);
    });
  });

  describe("addSession", () => {
    it("creates session with formatted label", async () => {
      await addWorkspace("/Users/jake/my-project");
      await addSession("/Users/jake/my-project", "my-project", "tab-1", "claude-1", "claude-code");
      const ws = get(workspaces);
      expect(ws[0]!.sessions).toHaveLength(1);
      expect(ws[0]!.sessions[0]!.label).toBe("My Project");
    });

    it("appends to workspace sessions array, so array order is insertion order", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1", "claude-1", "claude-code");
      await addSession("/a", "second", "tab-2", "claude-2", "claude-code");
      const ws = get(workspaces);
      expect(ws[0]!.sessions).toHaveLength(2);
      expect(ws[0]!.sessions[0]!.label).toBe("First");
      expect(ws[0]!.sessions[1]!.label).toBe("Second");
    });

    it("sets activeSessionId", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1", "claude-code");
      expect(get(activeSessionId)).toBeTruthy();
    });

    it("stores the claude session id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1", "claude-code");
      expect(get(workspaces)[0]!.sessions[0]!.claudeSessionId).toBe("claude-1");
    });

    it("stores a null claude session id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", null, "claude-code");
      expect(get(workspaces)[0]!.sessions[0]!.claudeSessionId).toBeNull();
    });

    it("stores the harness id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1", "omp");
      expect(get(workspaces)[0]!.sessions[0]!.harnessId).toBe("omp");
    });

    it("stores a null harness id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1", null);
      expect(get(workspaces)[0]!.sessions[0]!.harnessId).toBeNull();
    });
  });

  describe("resumeSession", () => {
    it("reattaches the tab and records the claude session id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", null, "claude-code");
      const sessionId = get(workspaces)[0]!.sessions[0]!.id;
      await resumeSession(sessionId, "tab-2", "claude-9");
      const session = get(workspaces)[0]!.sessions[0]!;
      expect(session.status).toBe("running");
      expect(session.terminalTabId).toBe("tab-2");
      expect(session.claudeSessionId).toBe("claude-9");
    });
  });

  describe("rebindSessionClaudeId", () => {
    it("retags the session whose tab id matches", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", OLD_ID, "claude-code");
      const changed = await rebindSessionClaudeId("tab-1", NEW_ID);
      expect(changed).toBe(true);
      expect(get(workspaces)[0]!.sessions[0]!.claudeSessionId).toBe(NEW_ID);
    });

    it("refuses an id that is not a UUID, since it is later typed into a shell", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", OLD_ID, "claude-code");
      vi.mocked(stateSave).mockClear();
      for (const bad of ["x; rm -rf ~", "--dangerously", "claude-new", ""]) {
        expect(await rebindSessionClaudeId("tab-1", bad)).toBe(false);
      }
      expect(get(workspaces)[0]!.sessions[0]!.claudeSessionId).toBe(OLD_ID);
      expect(stateSave).not.toHaveBeenCalled();
    });

    it("is a no-op when the id already matches", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", OLD_ID, "claude-code");
      vi.clearAllMocks();
      const changed = await rebindSessionClaudeId("tab-1", OLD_ID);
      expect(changed).toBe(false);
      expect(stateSave).not.toHaveBeenCalled();
    });

    it("leaves sessions on other tabs untouched", async () => {
      await addWorkspace("/a");
      await addSession("/a", "one", "tab-1", OLD_ID, "claude-code");
      await addSession("/a", "two", "tab-2", OTHER_ID, "claude-code");
      await rebindSessionClaudeId("tab-1", NEW_ID);
      const sessions = get(workspaces)[0]!.sessions;
      expect(sessions.find((s) => s.terminalTabId === "tab-2")?.claudeSessionId).toBe(OTHER_ID);
    });

    it("does nothing when no session owns that tab id", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", OLD_ID, "claude-code");
      const changed = await rebindSessionClaudeId("tab-missing", NEW_ID);
      expect(changed).toBe(false);
      expect(get(workspaces)[0]!.sessions[0]!.claudeSessionId).toBe(OLD_ID);
    });
  });

  describe("removeSession", () => {
    it("removes session from workspace", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1", "claude-code");
      const sessionId = get(workspaces)[0]!.sessions[0]!.id;
      await removeSession("/a", sessionId);
      expect(get(workspaces)[0]!.sessions).toHaveLength(0);
    });

    it("clears activeSessionId if it matches", async () => {
      await addWorkspace("/a");
      await addSession("/a", "test", "tab-1", "claude-1", "claude-code");
      const sessionId = get(workspaces)[0]!.sessions[0]!.id;
      activeSessionId.set(sessionId);
      await removeSession("/a", sessionId);
      expect(get(activeSessionId)).toBe("");
    });

    it("does not clear activeSessionId if it does not match", async () => {
      await addWorkspace("/a");
      await addSession("/a", "first", "tab-1", "claude-1", "claude-code");
      await addSession("/a", "second", "tab-2", "claude-2", "claude-code");
      const sessions = get(workspaces)[0]!.sessions;
      activeSessionId.set(sessions[0]!.id);
      await removeSession("/a", sessions[1]!.id);
      expect(get(activeSessionId)).toBe(sessions[0]!.id);
    });
  });

  describe("loadWorkspaces", () => {
    it("keeps a stored UUID session id and drops one that is not a UUID", async () => {
      const row = (id: string, claudeSessionId: string) => ({
        id,
        label: id,
        status: "idle",
        terminalTabId: null,
        createdAt: "",
        claudeSessionId,
      });
      mockFile(
        JSON.stringify({
          version: 1,
          workspaces: [
            {
              path: "/a",
              name: "a",
              color: WORKSPACE_COLORS[0],
              sessions: [
                row("good", OLD_ID),
                row("shell", "abc; touch /tmp/x"),
                row("flag", "--x"),
              ],
            },
          ],
        }),
      );
      await loadWorkspaces();
      const ids = Object.fromEntries(
        get(workspaces)[0]!.sessions.map((s) => [s.id, s.claudeSessionId]),
      );
      expect(ids).toEqual({ good: OLD_ID, shell: null, flag: null });
    });

    it("loads from file and resets running sessions to idle", async () => {
      mockFile(
        JSON.stringify([
          {
            path: "/a",
            name: "a",
            color: "#e67e80",
            sessions: [
              {
                id: "s1",
                label: "S1",
                status: "running",
                terminalTabId: null,
                createdAt: "",
                claudeSessionId: "claude-1",
              },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      const ws = get(workspaces);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.sessions[0]!.status).toBe("idle");
    });

    it("drops a malformed workspace or session and keeps the rest", async () => {
      mockFile(
        JSON.stringify([
          { name: "no path" },
          null,
          {
            path: "/b",
            name: "b",
            color: WORKSPACE_COLORS[0],
            sessions: [
              { id: "ok", label: "ok", status: "idle", createdAt: "" },
              { id: "odd", label: "odd", status: "exploded", createdAt: "" },
              "junk",
            ],
          },
        ]),
      );
      await loadWorkspaces();
      const ws = get(workspaces);
      expect(ws.map((w) => w.path)).toEqual(["/b"]);
      expect(ws[0]!.sessions.map((s) => s.id)).toEqual(["ok"]);
    });

    it("preserves claudeSessionId across a reload", async () => {
      mockFile(
        JSON.stringify([
          {
            path: "/a",
            name: "a",
            color: "#e67e80",
            sessions: [
              {
                id: "s1",
                label: "S1",
                status: "running",
                terminalTabId: "tab-1",
                createdAt: "",
                claudeSessionId: OLD_ID,
              },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      const session = get(workspaces)[0]!.sessions[0]!;
      expect(session.claudeSessionId).toBe(OLD_ID);
      expect(session.terminalTabId).toBeNull();
    });

    it("migrates sessions written without claudeSessionId to null", async () => {
      mockFile(
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
      expect(get(workspaces)[0]!.sessions[0]!.claudeSessionId).toBeNull();
    });

    it("migrates sessions written without harnessId to null", async () => {
      mockFile(
        JSON.stringify([
          {
            path: "/a",
            name: "a",
            color: "#e67e80",
            sessions: [
              {
                id: "s1",
                label: "S1",
                status: "idle",
                terminalTabId: null,
                createdAt: "",
                claudeSessionId: "claude-1",
              },
            ],
          },
        ]),
      );
      await loadWorkspaces();
      expect(get(workspaces)[0]!.sessions[0]!.harnessId).toBeNull();
    });

    it("migrates a retired Everforest colour onto the new palette", async () => {
      mockFile(
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
      mockFile(
        JSON.stringify([{ path: "/a", name: "a", color: WORKSPACE_COLORS[3], sessions: [] }]),
      );
      await loadWorkspaces();
      expect(get(workspaces)[0]!.color).toBe(WORKSPACE_COLORS[3]);
    });

    it("handles missing file gracefully", async () => {
      mockNoFile();
      await loadWorkspaces();
      expect(get(workspaces)).toEqual([]);
    });

    it("tells the user once where the backup went when the file was unusable", async () => {
      toasts.set([]);
      vi.mocked(stateLoad).mockResolvedValue({ contents: null, recovered: true });
      await loadWorkspaces();
      await loadWorkspaces();
      const recovered = get(toasts).filter(
        (t) => t.title === "Your workspaces file could not be read",
      );
      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.body).toContain("workspaces.json.bak");
      expect(get(workspaces)).toEqual([]);
    });

    it("loads what it understands from a file written by a newer version and says so", async () => {
      toasts.set([]);
      mockFile(
        JSON.stringify({
          version: WORKSPACES_VERSION + 1,
          workspaces: [{ path: "/a", name: "a", color: WORKSPACE_COLORS[0], sessions: [] }],
          somethingNew: true,
        }),
      );
      await loadWorkspaces();
      expect(get(workspaces).map((w) => w.path)).toEqual(["/a"]);
      expect(get(toasts).map((t) => t.title)).toContain(
        "Your workspaces were saved by a newer Atlas",
      );
    });
  });

  describe("storage failures", () => {
    it("tells the user once when workspaces cannot be saved", async () => {
      toasts.set([]);
      vi.mocked(stateSave)
        .mockRejectedValueOnce(new Error("denied"))
        .mockRejectedValueOnce(new Error("denied"));
      await addWorkspace("/a");
      await addWorkspace("/b");
      expect(get(toasts)).toHaveLength(1);
      expect(get(toasts)[0]!.title).toMatch(/save/i);
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
      await addSession("/a", "work", "tab-1", "claude-1", "claude-code");
      await hideWorkspace("/a");

      const ws = get(workspaces).find((w) => w.path === "/a");
      expect(ws?.sessions).toHaveLength(1);
      expect(ws?.sessions[0]?.terminalTabId).toBe("tab-1");
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

    it("brings a hidden workspace back when its folder is added again", async () => {
      await addWorkspace("/a");
      await hideWorkspace("/a");

      expect(await addWorkspace("/a")).toBe(true);
      expect(get(visibleWorkspaces).map((w) => w.path)).toEqual(["/a"]);
    });

    it("is a no-op when the workspace is already hidden", async () => {
      await addWorkspace("/a");
      await hideWorkspace("/a");
      vi.mocked(stateSave).mockClear();

      await hideWorkspace("/a");
      expect(get(removedWorkspaces)).toEqual(["/a"]);
      expect(stateSave).not.toHaveBeenCalled();
    });

    it("is a no-op when unhiding a workspace that is not hidden", async () => {
      await addWorkspace("/a");
      vi.mocked(stateSave).mockClear();

      await unhideWorkspace("/a");
      expect(get(removedWorkspaces)).toEqual([]);
      expect(stateSave).not.toHaveBeenCalled();
    });

    it("persists a hide and reloads it", async () => {
      await addWorkspace("/a");
      await addWorkspace("/b");
      await hideWorkspace("/a");

      const calls = vi.mocked(stateSave).mock.calls;
      const written = calls[calls.length - 1]![1] as string;
      expect(JSON.parse(written).removedWorkspaces).toEqual(["/a"]);

      workspaces.set([]);
      removedWorkspaces.set([]);
      mockFile(written);
      await loadWorkspaces();

      expect(get(removedWorkspaces)).toEqual(["/a"]);
      expect(get(visibleWorkspaces).map((w) => w.path)).toEqual(["/b"]);
      expect(get(workspaces)).toHaveLength(2);
    });

    it("reads a legacy bare-array file as nothing hidden", async () => {
      mockFile(
        JSON.stringify([{ path: "/a", name: "a", color: WORKSPACE_COLORS[0], sessions: [] }]),
      );
      await loadWorkspaces();

      expect(get(removedWorkspaces)).toEqual([]);
      expect(get(visibleWorkspaces)).toHaveLength(1);
    });
  });
});

describe("migrateWorkspaces", () => {
  it("reads a bare array (the oldest shape) as a workspace list", () => {
    const list = [{ path: "/a" }];
    expect(migrateWorkspaces(list)).toEqual({
      stored: { workspaces: list },
      newerThanKnown: false,
    });
  });

  it("flags only a version above the one this build writes", () => {
    expect(migrateWorkspaces({ workspaces: [] }).newerThanKnown).toBe(false);
    expect(migrateWorkspaces({ version: WORKSPACES_VERSION, workspaces: [] }).newerThanKnown).toBe(
      false,
    );
    expect(
      migrateWorkspaces({ version: WORKSPACES_VERSION + 1, workspaces: [] }).newerThanKnown,
    ).toBe(true);
  });

  it.each([null, "text", 3])("reads %j as an empty file", (raw) => {
    expect(migrateWorkspaces(raw)).toEqual({ stored: {}, newerThanKnown: false });
  });
});

describe("workspace persistence", () => {
  it("writes the schema version with every save", async () => {
    await addWorkspace("/versioned");
    const calls = vi.mocked(stateSave).mock.calls;
    expect(JSON.parse(calls[calls.length - 1]![1] as string).version).toBe(WORKSPACES_VERSION);
    workspaces.set([]);
  });
});
