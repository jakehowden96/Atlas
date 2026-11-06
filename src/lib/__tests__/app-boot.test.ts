import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  onPanelUpdate: vi.fn(),
  onSessionUpdate: vi.fn(),
  onClaudeSessionStart: vi.fn(),
  onBackToSessions: vi.fn(),
  onClaudeNotification: vi.fn(),
  connectorListPullRequests: vi.fn(),
  listWorkspaceRepos: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  ptyWrite: vi.fn(),
  ptyKill: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../stores/connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/connectors")>()),
  startConnectorEvents: vi.fn(async () => () => {}),
}));
vi.mock("../sound", () => ({ playPing: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { bootApp } from "../app-boot";
import type { ClaudeNotificationEvent } from "../../types/generated/ClaudeNotificationEvent";
import {
  onBackToSessions,
  onClaudeNotification,
  onClaudeSessionStart,
  onPanelUpdate,
  onSessionUpdate,
} from "../ipc";
import { playPing } from "../sound";
import { enableNotifications, soundOnNeedsYou } from "../stores/settings";
import { activeTabId, addTab, tabs } from "../stores/terminal";
import { activeView } from "../stores/view";

const LISTENERS = [
  onPanelUpdate,
  onSessionUpdate,
  onClaudeSessionStart,
  onBackToSessions,
  onClaudeNotification,
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const on of LISTENERS) vi.mocked(on).mockResolvedValue(vi.fn());
  tabs.set([]);
  activeTabId.set("");
  activeView.set("sessions");
  enableNotifications.set(true);
  soundOnNeedsYou.set(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bootApp", () => {
  it("has every event listener registered", async () => {
    const stop = await bootApp();

    for (const on of LISTENERS) expect(on).toHaveBeenCalledTimes(1);
    stop();
  });

  it("removes every listener when stopped", async () => {
    const unlisten = vi.fn();
    for (const on of LISTENERS) vi.mocked(on).mockResolvedValue(unlisten);

    const stop = await bootApp();
    stop();

    expect(unlisten).toHaveBeenCalledTimes(LISTENERS.length);
  });
});

describe("claude-notification", () => {
  async function deliver(event: ClaudeNotificationEvent, focused: boolean) {
    vi.stubGlobal("document", { hasFocus: () => focused });
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    const stop = await bootApp();
    const handler = vi.mocked(onClaudeNotification).mock.calls[0]![0];
    await handler(event);
    stop();
  }

  function permissionPrompt(sessionId: string): ClaudeNotificationEvent {
    return {
      session_id: sessionId,
      notification: {
        notification_type: "permission_prompt",
        title: "Claude needs permission",
        message: "Run Bash?",
        timestamp: "",
      },
    };
  }

  it("notifies for the active tab when Atlas is not the focused window", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    activeView.set("session");

    await deliver(permissionPrompt("t1"), false);

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the prompt is already on screen in the focused window", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    activeView.set("session");

    await deliver(permissionPrompt("t1"), true);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("flags the tab with the kind of prompt that raised it", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });

    await deliver(permissionPrompt("t1"), true);

    expect(get(tabs)[0]!.needsInput).toBe(true);
    expect(get(tabs)[0]!.needsInputKind).toBe("permission_prompt");
  });

  it("ignores the idle prompt, which needs nothing from the user", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    const idle = permissionPrompt("t1");
    idle.notification.notification_type = "idle_prompt";

    await deliver(idle, false);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(get(tabs)[0]!.needsInput).toBeUndefined();
  });

  it("pings when a session needs the user and the sound setting is on, even with notifications off", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    soundOnNeedsYou.set(true);
    enableNotifications.set(false);

    await deliver(permissionPrompt("t1"), true);

    expect(playPing).toHaveBeenCalledTimes(1);
  });

  it("does not ping with the sound setting off, nor for the idle prompt", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    await deliver(permissionPrompt("t1"), false);

    soundOnNeedsYou.set(true);
    const idle = permissionPrompt("t1");
    idle.notification.notification_type = "idle_prompt";
    await deliver(idle, false);

    expect(playPing).not.toHaveBeenCalled();
  });

  it("does not notify when notifications are switched off, but still flags the tab", async () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    enableNotifications.set(false);

    await deliver(permissionPrompt("t1"), false);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(get(tabs)[0]!.needsInput).toBe(true);
  });
});
