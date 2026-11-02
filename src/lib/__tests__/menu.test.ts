// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import MenuFixture from "./MenuFixture.svelte";

afterEach(cleanup);

async function setup() {
  const onselect = vi.fn();
  const user = userEvent.setup();
  render(MenuFixture, { onselect });
  const button = screen.getByRole("button", { name: "Actions" });
  return { onselect, user, button };
}

const focused = () => document.activeElement?.textContent?.trim();

describe("Menu", () => {
  it("opens from the button with ARIA state and focuses the first item", async () => {
    const { user, button } = await setup();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.click(button);
    await tick();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(focused()).toContain("Open");
  });

  it("moves with arrows (skipping disabled), Home, End and type-ahead", async () => {
    const { user, button } = await setup();
    await user.click(button);
    await tick();
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe("Rename");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(focused()).toContain("Delete");
    await user.keyboard("{ArrowDown}");
    expect(focused()).toContain("Open");
    await user.keyboard("{End}");
    expect(focused()).toContain("Delete");
    await user.keyboard("{Home}");
    expect(focused()).toContain("Open");
    await user.keyboard("d");
    expect(focused()).toContain("Delete");
  });

  it("activates with Enter and Space and closes", async () => {
    const { onselect, user, button } = await setup();
    await user.click(button);
    await tick();
    await user.keyboard("{Enter}");
    await tick();
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button);
    await tick();
    await user.keyboard("{ArrowDown} ");
    expect(onselect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "rename" }));
  });

  it("closes on Esc and returns focus to the trigger", async () => {
    const { user, button } = await setup();
    await user.click(button);
    await tick();
    await user.keyboard("{Escape}");
    await tick();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("marks disabled and danger rows and does not activate disabled", async () => {
    const { onselect, user, button } = await setup();
    await user.click(button);
    await tick();
    const locked = screen.getByRole("menuitem", { name: "Locked" });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    await user.click(locked);
    expect(onselect).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toContain("danger");
  });

  it("opens a submenu with Right, closes it with Left or Esc without closing the root", async () => {
    const { onselect, user, button } = await setup();
    await user.click(button);
    await tick();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(focused()).toBe("Copy link");
    await user.keyboard("{ArrowLeft}");
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(focused()).toContain("Share");
    await user.keyboard("{ArrowRight}{Escape}");
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    await user.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    await tick();
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: "mail" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("contextMenu action", () => {
  it("opens on right-click, suppressing the native menu, and returns focus", async () => {
    const { user } = await setup();
    const area = screen.getByTestId("area");
    area.focus();
    const notPrevented = await fireEvent.contextMenu(area, { clientX: 20, clientY: 30 });
    await tick();
    expect(notPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    await tick();
    await tick();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(area);
  });

  it("opens on Shift+F10 and the Menu key", async () => {
    const { user } = await setup();
    const area = screen.getByTestId("area");
    area.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await tick();
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    await tick();
    await tick();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(area);
    await fireEvent.keyDown(area, { key: "ContextMenu" });
    await tick();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("leaves the native menu alone when there are no items", async () => {
    await setup();
    const notPrevented = await fireEvent.contextMenu(screen.getByTestId("empty"));
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
