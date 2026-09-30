import { describe, it, expect } from "vitest";
import type { DiffFile } from "../diff-parser";
import {
  toFlat,
  dedupeKeys,
  buildTree,
  matchesFilter,
  sortedChildren,
  statusLetter,
  cssEscape,
  totalLines,
  toSplitRows,
  limitHunks,
  overBudgetKeys,
} from "../diff-view";

function makeFile(name: string, overrides?: Partial<DiffFile>): DiffFile {
  return {
    oldName: name,
    newName: name,
    changeType: "modified",
    hunks: [
      {
        header: "@@ -1,3 +1,4 @@",
        lines: [
          { type: "hunk-header", content: "@@ -1,3 +1,4 @@", oldNum: null, newNum: null },
          { type: "context", content: "unchanged", oldNum: 1, newNum: 1 },
          { type: "remove", content: "old line", oldNum: 2, newNum: null },
          { type: "add", content: "new line", oldNum: null, newNum: 2 },
          { type: "add", content: "another", oldNum: null, newNum: 3 },
        ],
      },
    ],
    ...overrides,
  } as DiffFile;
}

describe("toFlat", () => {
  it("counts added and removed lines", () => {
    const flat = toFlat(makeFile("a.ts"), "a.ts");
    expect(flat.key).toBe("a.ts");
    expect(flat.addedCount).toBe(2);
    expect(flat.removedCount).toBe(1);
  });
});

describe("dedupeKeys", () => {
  it("leaves unique keys untouched", () => {
    const items = [toFlat(makeFile("a.ts"), "a.ts"), toFlat(makeFile("b.ts"), "b.ts")];
    expect(dedupeKeys(items).map((i) => i.key)).toEqual(["a.ts", "b.ts"]);
  });

  it("suffixes duplicate keys", () => {
    const items = [
      toFlat(makeFile("a.ts"), "a.ts"),
      toFlat(makeFile("a.ts"), "a.ts"),
      toFlat(makeFile("a.ts"), "a.ts"),
    ];
    expect(dedupeKeys(items).map((i) => i.key)).toEqual(["a.ts", "a.ts#1", "a.ts#2"]);
  });
});

describe("buildTree", () => {
  it("nests files under directories", () => {
    const items = [
      toFlat(makeFile("src/lib/a.ts"), "src/lib/a.ts"),
      toFlat(makeFile("src/b.ts"), "src/b.ts"),
      toFlat(makeFile("top.ts"), "top.ts"),
    ];
    const tree = buildTree(items);
    const src = tree.children.get("src")!;
    expect(src.fileKey).toBeUndefined();
    expect(src.children.get("lib")!.children.get("a.ts")!.fileKey).toBe("src/lib/a.ts");
    expect(src.children.get("b.ts")!.fileKey).toBe("src/b.ts");
    expect(tree.children.get("top.ts")!.fileKey).toBe("top.ts");
  });

  it("records change type on file nodes", () => {
    const items = [toFlat(makeFile("a.ts", { changeType: "added" }), "a.ts")];
    const tree = buildTree(items);
    expect(tree.children.get("a.ts")!.changeType).toBe("added");
  });
});

describe("matchesFilter", () => {
  const tree = buildTree([
    toFlat(makeFile("src/lib/store.ts"), "src/lib/store.ts"),
    toFlat(makeFile("docs/readme.md"), "docs/readme.md"),
  ]);

  it("matches everything on empty filter", () => {
    expect(matchesFilter(tree.children.get("src")!, "")).toBe(true);
    expect(matchesFilter(tree.children.get("docs")!, "  ")).toBe(true);
  });

  it("matches directories whose descendants match", () => {
    expect(matchesFilter(tree.children.get("src")!, "store")).toBe(true);
    expect(matchesFilter(tree.children.get("docs")!, "store")).toBe(false);
  });

  it("is case-insensitive on file paths", () => {
    expect(matchesFilter(tree.children.get("src")!, "STORE")).toBe(true);
  });
});

describe("sortedChildren", () => {
  it("puts directories before files, each alphabetical", () => {
    const tree = buildTree([
      toFlat(makeFile("zz.ts"), "zz.ts"),
      toFlat(makeFile("aa.ts"), "aa.ts"),
      toFlat(makeFile("dir/x.ts"), "dir/x.ts"),
      toFlat(makeFile("alpha/y.ts"), "alpha/y.ts"),
    ]);
    expect(sortedChildren(tree).map((n) => n.name)).toEqual(["alpha", "dir", "aa.ts", "zz.ts"]);
  });
});

describe("statusLetter", () => {
  it("maps change types to letters", () => {
    expect(statusLetter("added")).toBe("A");
    expect(statusLetter("deleted")).toBe("D");
    expect(statusLetter("renamed")).toBe("R");
    expect(statusLetter("modified")).toBe("M");
    expect(statusLetter(undefined)).toBe("M");
  });
});

describe("cssEscape", () => {
  it("keeps alphanumerics and escapes the rest", () => {
    expect(cssEscape("abc-123_X")).toBe("abc-123_X");
    expect(cssEscape("a/b.ts")).toBe("a_2fb_2ets");
  });
});

describe("totalLines", () => {
  it("sums lines across hunks", () => {
    expect(totalLines(makeFile("a.ts"))).toBe(5);
  });
});

describe("toSplitRows", () => {
  it("pairs removes with adds and flushes around context", () => {
    const rows = toSplitRows(makeFile("a.ts"));
    expect(rows[0]).toEqual({ kind: "hunk", header: "@@ -1,3 +1,4 @@" });
    expect(rows[1].kind).toBe("context");
    // remove paired with first add, second add unpaired
    expect(rows[2]).toMatchObject({
      kind: "change",
      left: { num: 2, content: "old line" },
      right: { num: 2, content: "new line" },
    });
    expect(rows[3]).toMatchObject({
      kind: "change",
      left: null,
      right: { num: 3, content: "another" },
    });
    expect(rows).toHaveLength(4);
  });
});

function fileWithLines(name: string, count: number): DiffFile {
  return {
    oldName: name,
    newName: name,
    changeType: "modified",
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: Array.from({ length: count }, (_, i) => ({
          type: "add" as const,
          content: `line ${i}`,
          oldNum: null,
          newNum: i + 1,
        })),
      },
    ],
  };
}

describe("limitHunks", () => {
  it("returns everything, untouched, when the file fits", () => {
    const file = fileWithLines("a.ts", 10);
    const shown = limitHunks(file.hunks, 10);
    expect(shown.hunks).toBe(file.hunks);
    expect(shown.hidden).toBe(0);
  });

  it("cuts a long hunk at the limit and says how much is left", () => {
    const shown = limitHunks(fileWithLines("a.ts", 25).hunks, 10);
    expect(shown.hunks).toHaveLength(1);
    expect(shown.hunks[0].lines).toHaveLength(10);
    expect(shown.hidden).toBe(15);
  });

  it("spans hunks and drops those past the limit", () => {
    const hunks = [...fileWithLines("a.ts", 6).hunks, ...fileWithLines("a.ts", 6).hunks];
    const shown = limitHunks(hunks, 8);
    expect(shown.hunks.map((h) => h.lines.length)).toEqual([6, 2]);
    expect(shown.hidden).toBe(4);
  });
});

describe("overBudgetKeys", () => {
  const flat = (name: string, count: number) => toFlat(fileWithLines(name, count), name);

  it("keeps files inside the budget and collapses the ones after it", () => {
    const items = [flat("a", 300), flat("b", 300), flat("c", 300)];
    expect([...overBudgetKeys(items, 700)]).toEqual(["c"]);
  });

  it("always shows the first file, however large the budget is not", () => {
    expect([...overBudgetKeys([flat("a", 400)], 100)]).toEqual([]);
  });

  it("does not spend budget on files that are collapsed for their size anyway", () => {
    const items = [flat("big", 5000), flat("a", 300), flat("b", 300)];
    expect([...overBudgetKeys(items, 700)]).toEqual([]);
  });
});
