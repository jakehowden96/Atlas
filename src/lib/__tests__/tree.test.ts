// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Tree, { type TreeItem } from "../components/app/files/Tree.svelte";

afterEach(cleanup);

const items: TreeItem[] = [
  {
    id: "src",
    level: 1,
    expandable: true,
    expanded: false,
    parentId: null,
    label: "src",
    kind: "folder",
  },
  {
    id: "a",
    level: 2,
    expandable: false,
    expanded: false,
    parentId: "src",
    label: "a.ts",
    kind: "source",
  },
  {
    id: "r",
    level: 1,
    expandable: false,
    expanded: false,
    parentId: null,
    label: "README.md",
    kind: "md",
  },
];

describe("Tree", () => {
  it("is one tab stop with correct roles and levels", () => {
    render(Tree, { nodes: items, label: "Files" });
    expect(screen.getByRole("tree", { name: "Files" })).toBeTruthy();
    const rows = screen.getAllByRole("treeitem");
    expect(rows.map((r: HTMLElement) => r.tabIndex)).toEqual([0, -1, -1]);
    expect(rows[1]?.getAttribute("aria-level")).toBe("2");
    expect(rows[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(rows[2]?.hasAttribute("aria-expanded")).toBe(false);
  });
  it("arrows move focus and right expands", async () => {
    const user = userEvent.setup();
    const ontoggle = vi.fn();
    const onopen = vi.fn();
    render(Tree, { nodes: items, label: "Files", ontoggle, onopen });
    await user.tab();
    const rows = screen.getAllByRole("treeitem");
    expect(document.activeElement).toBe(rows[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    await user.keyboard("{ArrowUp}{ArrowRight}");
    expect(ontoggle).toHaveBeenCalledWith("src", true);
    await user.keyboard("{End}{Enter}");
    expect(onopen).toHaveBeenCalledWith("r");
  });
  it("emits rename, delete and menu intents", async () => {
    const user = userEvent.setup();
    const h = { onrename: vi.fn(), ondelete: vi.fn(), oncontextmenu: vi.fn() };
    render(Tree, { nodes: items, label: "Files", ...h });
    await user.tab();
    await user.keyboard("{F2}{Delete}{Shift>}{F10}{/Shift}");
    expect(h.onrename).toHaveBeenCalledWith("src");
    expect(h.ondelete).toHaveBeenCalledWith("src");
    expect(h.oncontextmenu).toHaveBeenCalledWith("src");
  });
});
