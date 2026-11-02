import { describe, expect, it } from "vitest";
import { navigate, typeahead, type TreeNode } from "../ui/tree-nav";

// src (open) > lib (open) > a.ts ; src > b.md ; docs (closed) ; z.json
const nodes: TreeNode[] = [
  { id: "src", level: 1, expandable: true, expanded: true, parentId: null, label: "src" },
  { id: "lib", level: 2, expandable: true, expanded: true, parentId: "src", label: "lib" },
  { id: "a", level: 3, expandable: false, expanded: false, parentId: "lib", label: "a.ts" },
  { id: "b", level: 2, expandable: false, expanded: false, parentId: "src", label: "b.md" },
  { id: "docs", level: 1, expandable: true, expanded: false, parentId: null, label: "docs" },
  { id: "z", level: 1, expandable: false, expanded: false, parentId: null, label: "z.json" },
];

describe("navigate", () => {
  it("moves down and up, clamping at the ends", () => {
    expect(navigate(nodes, "src", "ArrowDown")?.focusId).toBe("lib");
    expect(navigate(nodes, "z", "ArrowDown")?.focusId).toBe("z");
    expect(navigate(nodes, "lib", "ArrowUp")?.focusId).toBe("src");
    expect(navigate(nodes, "src", "ArrowUp")?.focusId).toBe("src");
  });
  it("jumps with Home and End", () => {
    expect(navigate(nodes, "b", "Home")?.focusId).toBe("src");
    expect(navigate(nodes, "b", "End")?.focusId).toBe("z");
  });
  it("right opens a collapsed parent without moving", () => {
    expect(navigate(nodes, "docs", "ArrowRight")).toEqual({
      focusId: "docs",
      toggle: { id: "docs", expand: true },
    });
  });
  it("right on an open parent goes to its first child", () => {
    expect(navigate(nodes, "src", "ArrowRight")).toEqual({ focusId: "lib" });
  });
  it("right on a leaf or an open empty parent stays", () => {
    expect(navigate(nodes, "z", "ArrowRight")).toEqual({ focusId: "z" });
    const empty: TreeNode[] = [
      { id: "e", level: 1, expandable: true, expanded: true, parentId: null },
      { id: "z", level: 1, expandable: false, expanded: false, parentId: null },
    ];
    expect(navigate(empty, "e", "ArrowRight")).toEqual({ focusId: "e" });
  });
  it("left closes an open parent", () => {
    expect(navigate(nodes, "lib", "ArrowLeft")).toEqual({
      focusId: "lib",
      toggle: { id: "lib", expand: false },
    });
  });
  it("left on a leaf or closed parent goes to the parent", () => {
    expect(navigate(nodes, "a", "ArrowLeft")).toEqual({ focusId: "lib" });
    const closed = nodes.map((n) => (n.id === "lib" ? { ...n, expanded: false } : n));
    expect(navigate(closed, "lib", "ArrowLeft")).toEqual({ focusId: "src", toggle: undefined });
  });
  it("left at a root leaf stays", () => {
    expect(navigate(nodes, "z", "ArrowLeft")).toEqual({ focusId: "z" });
  });
  it("ignores other keys and unknown ids", () => {
    expect(navigate(nodes, "src", "x")).toBeNull();
    expect(navigate(nodes, "nope", "ArrowDown")).toBeNull();
  });
});

describe("typeahead", () => {
  it("finds the next label by first letters", () => {
    expect(typeahead(nodes, "src", "d")).toBe("docs");
    expect(typeahead(nodes, "src", "b.")).toBe("b");
  });
  it("cycles on a repeated letter and wraps", () => {
    expect(typeahead(nodes, "docs", "d")).toBe("docs");
    expect(typeahead(nodes, "z", "s")).toBe("src");
  });
  it("returns null with no match or empty query", () => {
    expect(typeahead(nodes, "src", "q")).toBeNull();
    expect(typeahead(nodes, "src", "")).toBeNull();
  });
});
