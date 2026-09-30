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

import { ptyWrite } from "../ipc";
import { allowPendingTool, denyPendingTool } from "../session-actions";
import { toasts } from "../stores/toast";
import {
  activeTabId,
  addTab,
  setPermissionPromptVisible,
  setTabNeedsInput,
  tabs,
} from "../stores/terminal";
import type { TabItem } from "../../types/terminal";

function tab(overrides: Partial<TabItem> = {}): TabItem {
  return {
    type: "terminal",
    id: "t1",
    title: "",
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
