// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Tree, { type TreeItem } from "../components/ui/Tree.svelte";

afterEach(cleanup);

const nodes: TreeItem[] = [
  {
    id: "a",
    label: "a",
    kind: "folder",
    level: 1,
    expandable: true,
    expanded: false,
    parentId: null,
  },
  {
    id: "a/x.md",
    label: "x.md",
    kind: "md",
    level: 2,
    expandable: false,
    expanded: false,
    parentId: "a",
  },
];

it("opens a row on click and toggles, without opening, on its twisty", async () => {
  const onopen = vi.fn();
  const ontoggle = vi.fn();
  const { container } = render(Tree, { nodes, label: "Files", onopen, ontoggle });

  await userEvent.click(screen.getByText("x.md"));
  expect(onopen).toHaveBeenCalledWith("a/x.md");

  await userEvent.click(container.querySelector('[data-id="a"] [data-twisty]')!);
  expect(ontoggle).toHaveBeenCalledWith("a", true);
  expect(onopen).toHaveBeenCalledTimes(1);
});
