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

  // Arrow roving, type-ahead and submenu keys are bits-ui's (shadcn DropdownMenu); these check our mapping.
  it("selects a clicked item and closes", async () => {
    const { onselect, user, button } = await setup();
    await user.click(button);
    await tick();
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await tick();
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: "rename" }));
    expect(screen.queryByRole("menu")).toBeNull();
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

  it("marks disabled and danger rows, renders shortcuts and a submenu trigger", async () => {
    const { onselect, user, button } = await setup();
    await user.click(button);
    await tick();
    const locked = screen.getByRole("menuitem", { name: "Locked" });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    await user.click(locked);
    expect(onselect).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Delete" }).dataset.variant).toBe("destructive");
    expect(screen.getByRole("menuitem", { name: /Open/ }).textContent).toContain("Enter");
    expect(screen.getByRole("menuitem", { name: "Share" }).getAttribute("aria-haspopup")).toBe("menu");
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
