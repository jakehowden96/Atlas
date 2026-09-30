import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import {
  activeSessionComments,
  addComment,
  anchorDomKey,
  clearForSession,
  removeComment,
  reviewComments,
  type ReviewAnchor,
} from "../stores/reviewComments";
import { activeTabId } from "../stores/terminal";

function anchor(overrides: Partial<ReviewAnchor> = {}): ReviewAnchor {
  return {
    fileKey: "src/a.ts",
    side: "+",
    oldNum: null,
    newNum: 1,
    hunkHeader: "@@ -1 +1 @@",
    contentSnippet: "x",
    ...overrides,
  };
}

describe("review comments store", () => {
  beforeEach(() => {
    for (const id of get(reviewComments).keys()) clearForSession(id);
    activeTabId.set("");
  });

  it("keeps a session's comments in the order they were added", () => {
    addComment("t1", anchor({ newNum: 9 }), "late line, first comment");
    addComment("t1", anchor({ newNum: 2 }), "early line, second comment");
    expect(
      get(reviewComments)
        .get("t1")
        ?.map((c) => c.body),
    ).toEqual(["late line, first comment", "early line, second comment"]);
  });

  it("drops the session's entry once its last comment is removed", () => {
    const only = addComment("t1", anchor(), "a");
    removeComment("t1", only.id);
    expect(get(reviewComments).has("t1")).toBe(false);
  });

  it("removes only the comment asked for and leaves other sessions alone", () => {
    const a = addComment("t1", anchor(), "a");
    addComment("t1", anchor({ newNum: 2 }), "b");
    addComment("t2", anchor(), "c");
    removeComment("t1", a.id);
    expect(
      get(reviewComments)
        .get("t1")
        ?.map((c) => c.body),
    ).toEqual(["b"]);
    expect(get(reviewComments).get("t2")).toHaveLength(1);
  });

  it("ignores a remove for an id the session does not hold", () => {
    addComment("t1", anchor(), "a");
    removeComment("t1", "missing");
    removeComment("never-seen", "missing");
    expect(get(reviewComments).get("t1")).toHaveLength(1);
    expect(get(reviewComments).has("never-seen")).toBe(false);
  });

  it("prunes a whole session without notifying when it held nothing", () => {
    addComment("t1", anchor(), "a");
    const before = get(reviewComments);
    clearForSession("unknown");
    expect(get(reviewComments)).toBe(before);
    clearForSession("t1");
    expect(get(reviewComments).has("t1")).toBe(false);
  });

  it("follows the active tab, and is empty for a tab with no comments", () => {
    addComment("t1", anchor(), "a");
    activeTabId.set("t1");
    expect(get(activeSessionComments)).toHaveLength(1);
    activeTabId.set("t2");
    expect(get(activeSessionComments)).toEqual([]);
  });

  it("gives the two sides of a changed line different DOM keys", () => {
    const removed = anchorDomKey(anchor({ side: "-", oldNum: 4, newNum: null }));
    const added = anchorDomKey(anchor({ side: "+", oldNum: null, newNum: 4 }));
    expect(removed).not.toBe(added);
  });
});
