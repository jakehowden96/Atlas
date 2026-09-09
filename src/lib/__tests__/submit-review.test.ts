import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  ptyWrite: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

import { ptyWrite } from "../ipc";
import { submitReview } from "../review/submitReview";
import {
  addComment,
  clearForSession,
  reviewComments,
  type ReviewAnchor,
} from "../stores/reviewComments";
import { tabs, activeTabId } from "../stores/terminal";
import { toasts } from "../stores/toast";
import type { TabItem } from "../../types/terminal";
import type { Terminal } from "@xterm/xterm";

function tab(id: string, ptyId: number): TabItem {
  return {
    type: "terminal",
    id,
    title: "",
    ptyId,
    terminal: {} as unknown as Terminal,
  };
}

function anchor(fileKey: string, newNum: number): ReviewAnchor {
  return {
    fileKey,
    side: "+",
    oldNum: null,
    newNum,
    hunkHeader: `@@ -1,1 +${newNum},1 @@`,
    contentSnippet: "const x = 1;",
  };
}

/** `ptyWrite` is called with the raw bytes-as-string; decode nothing here. */
function lastPrompt(): string {
  const calls = vi.mocked(ptyWrite).mock.calls;
  return calls[calls.length - 1][1];
}

describe("submitReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabs.set([]);
    activeTabId.set("");
    toasts.set([]);
    // The comment map is module state; drain whatever a prior test left.
    for (const sid of [...get(reviewComments).keys()]) clearForSession(sid);
  });

  it("writes the formatted prompt into the tab's pty and clears the comments", async () => {
    tabs.set([tab("tab-a", 7)]);
    addComment("tab-a", anchor("src/a.ts", 12), "rename this");
    addComment("tab-a", anchor("src/b.ts", 3), "drop the guard");

    await submitReview("tab-a");

    expect(ptyWrite).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ptyWrite).mock.calls[0][0]).toBe(7);
    const prompt = lastPrompt();
    expect(prompt).toContain("src/a.ts:12");
    expect(prompt).toContain("rename this");
    expect(prompt).toContain("src/b.ts:3");
    expect(prompt.endsWith("\r")).toBe(true);
    expect(get(reviewComments).get("tab-a")).toBeUndefined();
  });

  it("only sends the named session's comments and leaves the others alone", async () => {
    tabs.set([tab("tab-a", 1), tab("tab-b", 2)]);
    addComment("tab-a", anchor("src/a.ts", 1), "for A");
    addComment("tab-b", anchor("src/b.ts", 2), "for B");
    // The drawer reads the *active* tab, but the submit path is keyed by the
    // id it is handed — a stale activeTabId must not leak the wrong session.
    activeTabId.set("tab-b");

    await submitReview("tab-a");

    expect(vi.mocked(ptyWrite).mock.calls[0][0]).toBe(1);
    expect(lastPrompt()).toContain("for A");
    expect(lastPrompt()).not.toContain("for B");
    expect(get(reviewComments).get("tab-a")).toBeUndefined();
    expect(get(reviewComments).get("tab-b")).toHaveLength(1);
  });

  it("does nothing when the session has no comments", async () => {
    tabs.set([tab("tab-a", 1)]);
    await submitReview("tab-a");
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("toasts instead of writing when the session has no live pty", async () => {
    tabs.set([tab("tab-a", -1)]);
    addComment("tab-a", anchor("src/a.ts", 1), "hello");

    await submitReview("tab-a");

    expect(ptyWrite).not.toHaveBeenCalled();
    expect(get(toasts)[0].body).toMatch(/No active Claude terminal/);
    // The comments survive a failed send.
    expect(get(reviewComments).get("tab-a")).toHaveLength(1);
  });

  it("keeps the comments when the pty write fails", async () => {
    tabs.set([tab("tab-a", 4)]);
    addComment("tab-a", anchor("src/a.ts", 1), "hello");
    vi.mocked(ptyWrite).mockRejectedValueOnce(new Error("pty gone"));

    await submitReview("tab-a");

    expect(get(reviewComments).get("tab-a")).toHaveLength(1);
    expect(get(toasts)[0].body).toMatch(/pty gone/);
  });
});
