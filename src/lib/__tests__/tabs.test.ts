// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Tabs, { partitionTabs, type Tab } from "../components/ui/Tabs.svelte";

const tabs: Tab[] = [
  { id: "a", label: "One", group: "G1" },
  { id: "b", label: "Two", dirty: true, group: "G1" },
  { id: "c", label: "Three", group: "G2" },
];

describe("partitionTabs", () => {
  it("shows everything when it fits", () => {
    expect(partitionTabs([50, 50], 0, 100, 40)).toEqual({ visible: [0, 1], hidden: [] });
  });
  it("hides what does not fit and reserves room for the menu", () => {
    expect(partitionTabs([50, 50, 50, 50], 0, 200 - 1, 40)).toEqual({ visible: [0, 1, 2], hidden: [3] });
  });
  it("always keeps the selected tab visible, in order", () => {
    const r = partitionTabs([50, 50, 50, 50, 50], 4, 150, 40);
    expect(r.visible).toContain(4);
    expect(r.visible).toEqual([0, 4]);
    expect(r.hidden).toEqual([1, 2, 3]);
  });
});

describe("Tabs", () => {
  afterEach(cleanup);

  it("has tablist/tab roles, selection and tabpanel linkage", () => {
    render(Tabs, { tabs, value: "b", onselect: () => {}, label: "Files", panel: undefined });
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("horizontal");
    const two = screen.getByRole("tab", { name: "Two" });
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(two.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "One" }).tabIndex).toBe(-1);
  });

  it("arrows, Home and End move selection", async () => {
    const onselect = vi.fn();
    render(Tabs, { tabs, value: "a", onselect, label: "Files" });
    const user = userEvent.setup();
    screen.getByRole("tab", { name: "One" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onselect).toHaveBeenLastCalledWith("b");
    await user.keyboard("{End}");
    expect(onselect).toHaveBeenLastCalledWith("c");
    await user.keyboard("{Home}");
    expect(onselect).toHaveBeenLastCalledWith("a");
  });

  it("ctrl+W and middle-click close; close button is labelled", async () => {
    const onclose = vi.fn();
    render(Tabs, { tabs, value: "a", onselect: () => {}, onclose, label: "Files" });
    const one = screen.getByRole("tab", { name: "One" });
    await fireEvent.keyDown(one, { key: "w", ctrlKey: true });
    expect(onclose).toHaveBeenLastCalledWith("a");
    await fireEvent(screen.getByRole("tab", { name: "Two" }), new MouseEvent("auxclick", { button: 1, bubbles: true }));
    expect(onclose).toHaveBeenLastCalledWith("b");
    await userEvent.setup().click(screen.getByRole("button", { name: "Close Three" }));
    expect(onclose).toHaveBeenLastCalledWith("c");
  });

  it("unsaved tab has a dot beside its close button", () => {
    const { container } = render(Tabs, { tabs, value: "a", onselect: () => {}, onclose: () => {}, label: "Files" });
    expect(container.querySelectorAll(".dot").length).toBe(1);
    expect(screen.getByRole("button", { name: "Close Two" })).toBeTruthy();
  });

  it("vertical uses up/down arrows, orientation and group headings", async () => {
    const onselect = vi.fn();
    render(Tabs, { tabs, value: "a", onselect, vertical: true, label: "Settings" });
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByText("G1")).toBeTruthy();
    expect(screen.getByText("G2")).toBeTruthy();
    const user = userEvent.setup();
    screen.getByRole("tab", { name: "One" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onselect).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}");
    expect(onselect).toHaveBeenLastCalledWith("b");
  });
});
