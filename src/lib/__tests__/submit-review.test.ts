import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  ptyWrite: vi.fn(),
}));
import { ptyWrite } from "../ipc";
import { submitReview } from "../review/submitReview";
import { REVIEW_PROMPT_INTRO } from "../review/formatPrompt";
import {
  addComment,
  clearForSession,
  reviewComments,
  type ReviewAnchor,
} from "../stores/reviewComments";
import { tabs, activeTabId } from "../stores/terminal";
import { toasts } from "../stores/toast";
import type { TabItem } from "../../types/terminal";

function tab(id: string, ptyId: number): TabItem {
  return {
    type: "terminal",
    id,
    ptyId,
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
function sentPrompt(): string {
  return vi.mocked(ptyWrite).mock.calls[0]![1];
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

    vi.useFakeTimers();
    const done = submitReview("tab-a");
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();

    const calls = vi.mocked(ptyWrite).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe(7);
    expect(calls[1]![0]).toBe(7);
    const prompt = calls[0]![1];
    expect(prompt.startsWith(`${REVIEW_PROMPT_INTRO} \x1b[200~`)).toBe(true);
    expect(prompt.endsWith("\x1b[201~")).toBe(true);
    expect(prompt).toContain("src/a.ts:12");
    expect(prompt).toContain("rename this");
    expect(prompt).toContain("src/b.ts:3");
    expect(calls[1]![1]).toBe("\r");
    expect(get(reviewComments).get("tab-a")).toBeUndefined();
  });

  it("wraps a long multi-comment review entirely between the paste markers", async () => {
    tabs.set([tab("tab-a", 7)]);
    for (let i = 1; i <= 10; i++) {
      addComment("tab-a", anchor(`src/f${i}.ts`, i), `line one\nline two\n${"x".repeat(300)}`);
    }

    vi.useFakeTimers();
    const done = submitReview("tab-a");
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();

    const prompt = vi.mocked(ptyWrite).mock.calls[0]![1];
    expect(prompt.length).toBeGreaterThan(3000);
    const start = prompt.indexOf("\x1b[200~");
    const end = prompt.indexOf("\x1b[201~");
    const body = prompt.slice(start + 6, end);
    for (let i = 1; i <= 10; i++) expect(body).toContain(`[${i}] src/f${i}.ts:${i}`);
    expect(prompt.replace("\x1b[200~", "").replace("\x1b[201~", "")).not.toContain("\x1b");
  });

  it("only sends the named session's comments and leaves the others alone", async () => {
    tabs.set([tab("tab-a", 1), tab("tab-b", 2)]);
    addComment("tab-a", anchor("src/a.ts", 1), "for A");
    addComment("tab-b", anchor("src/b.ts", 2), "for B");
    // The drawer reads the *active* tab, but the submit path is keyed by the
    // id it is handed — a stale activeTabId must not leak the wrong session.
    activeTabId.set("tab-b");

    vi.useFakeTimers();
    const done = submitReview("tab-a");
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();

    expect(vi.mocked(ptyWrite).mock.calls[0]![0]).toBe(1);
    expect(sentPrompt()).toContain("for A");
    expect(sentPrompt()).not.toContain("for B");
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
    expect(get(toasts)).toHaveLength(1);
    // The comments survive a failed send.
    expect(get(reviewComments).get("tab-a")).toHaveLength(1);
  });

  it("keeps the comments when the pty write fails", async () => {
    tabs.set([tab("tab-a", 4)]);
    addComment("tab-a", anchor("src/a.ts", 1), "hello");
    vi.mocked(ptyWrite).mockRejectedValueOnce(new Error("pty gone"));

    await submitReview("tab-a");

    expect(get(reviewComments).get("tab-a")).toHaveLength(1);
    expect(get(toasts)[0]!.body).toMatch(/pty gone/);
  });
});
