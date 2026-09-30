import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  ptyKill: vi.fn(),
  ptyWrite: vi.fn(),
  startOmpTail: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
}));

import { ptyKill, ptyWrite, startSessionTail, stopSessionTail } from "../ipc";
import {
  allowPendingTool,
  closeSession,
  closeSessionTab,
  denyPendingTool,
  handleClaudeSessionStart,
  handleTerminalExit,
  spawnHarnessSession,
} from "../session-actions";
import { liveSessions, upsertLiveSession } from "../stores/liveSessions";
import { sessionTouchedFiles, setSessionTouchedFiles } from "../stores/panel";
import { addComment, reviewComments } from "../stores/reviewComments";
import { toasts } from "../stores/toast";
import { workspaces, type WorkspaceSession } from "../stores/workspace";
import type { LiveSession } from "../../types/session";
import {
  activeTabId,
  addTab,
  setPermissionPromptVisible,
  setTabNeedsInput,
  tabs,
} from "../stores/terminal";
import type { TabItem } from "../../types/terminal";

beforeEach(() => {
  vi.mocked(ptyWrite).mockResolvedValue(undefined);
  vi.mocked(ptyKill).mockResolvedValue(undefined);
  vi.mocked(startSessionTail).mockResolvedValue(undefined);
  vi.mocked(stopSessionTail).mockResolvedValue(undefined);
});

function tab(overrides: Partial<TabItem> = {}): TabItem {
  return {
    type: "terminal",
    id: "t1",
    ptyId: 7,
    ...overrides,
  };
}

describe("answering a permission prompt from a tile", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
    toasts.set([]);
    vi.clearAllMocks();
  });

  it("types nothing while no permission prompt is on the terminal screen", async () => {
    addTab(tab());
    setTabNeedsInput("t1", true, "permission_prompt");

    await allowPendingTool("t1");
    await denyPendingTool("t1");

    expect(ptyWrite).not.toHaveBeenCalled();
    expect(get(tabs)[0].needsInput).toBe(true);
  });

  it("types nothing for an elicitation dialog even if the screen looks like a prompt", async () => {
    addTab(tab());
    setTabNeedsInput("t1", true, "elicitation_dialog");
    setPermissionPromptVisible("t1", true);

    await allowPendingTool("t1");

    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("allows with the highlighted default and clears the flag once the prompt is on screen", async () => {
    addTab(tab());
    setTabNeedsInput("t1", true, "permission_prompt");
    setPermissionPromptVisible("t1", true);

    await allowPendingTool("t1");

    expect(ptyWrite).toHaveBeenCalledWith(7, "\r");
    expect(get(tabs)[0].needsInput).toBe(false);
  });

  it("denies with Escape once the prompt is on screen", async () => {
    addTab(tab());
    setTabNeedsInput("t1", true, "permission_prompt");
    setPermissionPromptVisible("t1", true);

    await denyPendingTool("t1");

    expect(ptyWrite).toHaveBeenCalledWith(7, "\x1b");
  });

  it("surfaces a failed write instead of rejecting into the click handler", async () => {
    vi.mocked(ptyWrite).mockRejectedValueOnce(new Error("pty gone"));
    addTab(tab());
    setTabNeedsInput("t1", true, "permission_prompt");
    setPermissionPromptVisible("t1", true);

    await expect(allowPendingTool("t1")).resolves.toBeUndefined();

    expect(get(toasts)).toHaveLength(1);
    expect(get(tabs)[0].needsInput).toBe(true);
  });
});

const UUID = "3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b";
const OTHER_UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function row(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    id: "row-1",
    label: "Session",
    status: "running",
    terminalTabId: "t1",
    createdAt: "2026-09-01T00:00:00Z",
    claudeSessionId: UUID,
    harnessId: "claude-code",
    ...overrides,
  };
}

function live(sessionUuid: string): LiveSession {
  return {
    sessionUuid,
    state: "running",
    startedAt: null,
    lastActivity: null,
    title: null,
    model: null,
    gitBranch: null,
    lines: [],
    plan: [],
    subagents: [],
    toolCalls: 0,
    lastTool: null,
    pendingTool: null,
    outputTokens: 0,
    costEstimate: 0,
    contextTokens: 0,
    peakContext: 0,
    contextPct: 0,
    lastPrompt: null,
    lastReply: null,
    turnEndedAt: null,
    turnDurationMs: null,
  };
}

describe("session ids typed into the shell", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
    workspaces.set([{ path: "/w", name: "w", sessions: [row({ terminalTabId: null })] }]);
    vi.clearAllMocks();
  });

  it("refuses to resume an id that is not a UUID rather than typing it into a shell", async () => {
    await expect(
      spawnHarnessSession("/w", {
        existingSessionId: "row-1",
        resumeSessionId: "x; touch /tmp/pwned",
        harnessId: "claude-code",
      }),
    ).rejects.toThrow();

    expect(get(tabs)).toHaveLength(0);
    expect(get(workspaces)[0].sessions[0].claudeSessionId).toBe(UUID);
  });

  it("does not rebind a session to a non-UUID id reported by the hook", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [row()] }]);

    await handleClaudeSessionStart("t1", "x; touch /tmp/pwned");

    expect(get(workspaces)[0].sessions[0].claudeSessionId).toBe(UUID);
  });

  it("rebinds to a new UUID after /clear", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [row()] }]);

    await handleClaudeSessionStart("t1", OTHER_UUID);

    expect(get(workspaces)[0].sessions[0].claudeSessionId).toBe(OTHER_UUID);
  });
});

describe("resuming a conversation that is already open", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
    vi.clearAllMocks();
  });

  it("focuses the open tab instead of starting a second claude on the same transcript", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [row()] }]);
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    addTab({ type: "terminal", id: "other", ptyId: 8 });

    const session = await spawnHarnessSession("/w", {
      existingSessionId: "row-1",
      resumeSessionId: UUID,
      harnessId: "claude-code",
    });

    expect(session.id).toBe("row-1");
    expect(get(tabs).map((t) => t.id)).toEqual(["t1", "other"]);
    expect(get(activeTabId)).toBe("t1");
    expect(get(workspaces)[0].sessions[0].terminalTabId).toBe("t1");
  });
});

describe("ending a session's transcript tail", () => {
  beforeEach(() => {
    tabs.set([]);
    liveSessions.set(new Map());
    vi.clearAllMocks();
  });

  it("leaves no live entry behind when a last update lands while the tail is stopping", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [row({ terminalTabId: null })] }]);
    upsertLiveSession(live(UUID));
    let finishStop: () => void = () => {};
    vi.mocked(stopSessionTail).mockReturnValue(
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
    );

    const closing = closeSession("row-1");
    upsertLiveSession(live(UUID));
    finishStop();
    await closing;

    expect(get(liveSessions).has(UUID)).toBe(false);
  });
});

describe("closing a session's terminal tab", () => {
  beforeEach(() => {
    tabs.set([]);
    vi.clearAllMocks();
  });

  it("forgets the review comments and touched files kept for that tab", async () => {
    addTab({ type: "terminal", id: "t9", ptyId: 7 });
    addComment(
      "t9",
      {
        fileKey: "a.ts",
        side: "+",
        oldNum: null,
        newNum: 1,
        hunkHeader: "@@",
        contentSnippet: "x",
      },
      "rename",
    );
    setSessionTouchedFiles("t9", [{ path: "a.ts", added: 1, removed: 0, repo: "" }]);

    await closeSessionTab("t9");

    expect(get(reviewComments).has("t9")).toBe(false);
    expect(get(sessionTouchedFiles).has("t9")).toBe(false);
  });
});

describe("a shell that exits on its own", () => {
  beforeEach(() => {
    tabs.set([]);
    activeTabId.set("");
    liveSessions.set(new Map());
    toasts.set([]);
    vi.clearAllMocks();
    vi.mocked(stopSessionTail).mockResolvedValue(undefined);
  });

  it("moves the session row to idle, keeps its tab, and stops the tail", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [row()] }]);
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    upsertLiveSession(live(UUID));

    await handleTerminalExit("t1");

    const session = get(workspaces)[0].sessions[0];
    expect(session.status).toBe("idle");
    // The row keeps its tab, so the tile stays put and shows why it stopped.
    expect(session.terminalTabId).toBe("t1");
    expect(get(tabs)).toHaveLength(1);
    expect(get(tabs)[0].exited).toBe(true);
    expect(stopSessionTail).toHaveBeenCalledWith(UUID);
    expect(get(liveSessions).has(UUID)).toBe(false);
  });

  it("types nothing into the dead PTY when a tile answers a stale prompt", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [row()] }]);
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    setTabNeedsInput("t1", true, "permission_prompt");
    setPermissionPromptVisible("t1", true);

    await handleTerminalExit("t1");
    await allowPendingTool("t1");

    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("still ends a tab that no session row owns", async () => {
    workspaces.set([{ path: "/w", name: "w", sessions: [] }]);
    addTab({ type: "terminal", id: "t1", ptyId: 7 });

    await expect(handleTerminalExit("t1")).resolves.toBeUndefined();

    expect(get(tabs)[0].exited).toBe(true);
    expect(stopSessionTail).not.toHaveBeenCalled();
  });
});
