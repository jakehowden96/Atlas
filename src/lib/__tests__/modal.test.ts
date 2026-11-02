// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet } from "svelte";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Modal from "../components/ui/Modal.svelte";
import Drawer from "../components/ui/Drawer.svelte";

const children = createRawSnippet(() => ({
  render: () => `<div><button>First</button><button>Last</button></div>`,
}));
const footer = createRawSnippet(() => ({
  render: () => `<button>Cancel</button>`,
}));

afterEach(cleanup);

// happy-dom does no layout; Modal's tabbables() skips zero-size elements.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });

describe("Modal", () => {
  it("has an accessible name from title, labelledBy or ariaLabel", () => {
    const a = render(Modal, { open: true, onClose() {}, title: "Settings", children });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    a.unmount();
    render(Modal, { open: true, onClose() {}, ariaLabel: "Palette", children });
    expect(screen.getByRole("dialog", { name: "Palette" })).toBeTruthy();
  });

  it("closes once on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(Modal, { open: true, onClose, title: "T", children });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("skips Escape a consumer already handled", () => {
    const onClose = vi.fn();
    render(Modal, { open: true, onClose, title: "T", children });
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    ev.preventDefault();
    screen.getByRole("dialog").dispatchEvent(ev);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps focus and restores it on close", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(Modal, { open: true, onClose() {}, title: "T", children, footer });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("First")));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText("Cancel"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("First"));
    await rerender({ open: false });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("scrolls the body while header and footer stay outside it", () => {
    render(Modal, { open: true, onClose() {}, title: "T", children, footer });
    const dialog = screen.getByRole("dialog");
    const body = dialog.querySelector(".body") as HTMLElement;
    expect(body.contains(screen.getByText("First"))).toBe(true);
    expect(body.contains(dialog.querySelector(".head"))).toBe(false);
    expect(body.contains(dialog.querySelector(".foot"))).toBe(false);
  });
});

describe("Drawer", () => {
  it("is a named dialog that closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(Drawer, { open: true, onClose, title: "Changes", children });
    expect(screen.getByRole("dialog", { name: "Changes" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
