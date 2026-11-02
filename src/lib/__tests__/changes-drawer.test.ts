// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";

vi.mock("../ipc", () => ({ refreshPanel: vi.fn(async () => null) }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../review/submitReview", () => ({ submitReview: vi.fn() }));

import ChangesDrawer from "../components/changes/ChangesDrawer.svelte";
import { panelData } from "../stores/panel";
import { activeSessionComments, addComment, clearForSession } from "../stores/reviewComments";
import { toasts } from "../stores/toast";
import { activeTabId, tabs } from "../stores/terminal";
import { diffOpen } from "../stores/view";
import type { PanelData } from "../../types/generated/PanelData";

// happy-dom does no layout; Modal's tabbables() skips zero-size elements.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });
Element.prototype.scrollIntoView = () => {};

const RAW = [
  "diff --git a/a.ts b/a.ts",
  "index 111..222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "",
].join("\n");

const anchor = {
  fileKey: "a.ts",
  side: "+" as const,
  oldNum: null,
  newNum: 2,
  hunkHeader: "@@ -1,2 +1,2 @@",
  contentSnippet: "new",
};

function panel(over: Partial<PanelData> = {}): PanelData {
  return {
    version: 1,
    timestamp: "",
    cwd: "/w",
    diff: {
      raw: RAW,
      files_changed: 1,
      lines_added: 1,
      lines_removed: 1,
      fingerprint: "f1",
    },
    ...over,
  };
}

beforeEach(() => {
  tabs.set([{ id: "t1", cwd: "/w" }] as never);
  activeTabId.set("t1");
  panelData.set(panel());
  diffOpen.set(true);
  toasts.set([]);
});

afterEach(() => {
  cleanup();
  clearForSession("t1");
});

// The tree lists the same path as a button; the card header is the one that discloses.
async function fileToggle() {
  return await waitFor(() => {
    const el = screen
      .getAllByRole("button", { name: /a\.ts/ })
      .find((b) => b.hasAttribute("aria-expanded"));
    if (!el) throw new Error("no file header");
    return el;
  });
}

describe("diff file card", () => {
  it("is a disclosure button with the Viewed checkbox beside it, not inside it", async () => {
    const user = userEvent.setup();
    render(ChangesDrawer, { open: true });
    const toggle = await fileToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(toggle).queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Viewed" })).toBeTruthy();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("names the change type", async () => {
    render(ChangesDrawer, { open: true });
    expect(await screen.findByRole("img", { name: "Modified" })).toBeTruthy();
  });

  it("marking a file viewed updates the count", async () => {
    const user = userEvent.setup();
    render(ChangesDrawer, { open: true });
    await user.click(await screen.findByRole("checkbox", { name: "Viewed" }));
    expect(screen.getByText("viewed 1/1")).toBeTruthy();
  });
});

describe("empty states", () => {
  it("says the tree is clean", async () => {
    panelData.set(panel({ diff: null }));
    render(ChangesDrawer, { open: true });
    expect(await screen.findByText("Working tree clean")).toBeTruthy();
  });

  it("offers to copy the git install command", async () => {
    panelData.set(panel({ diff: null, issue: "git_not_found" }));
    render(ChangesDrawer, { open: true });
    expect(await screen.findByText("Git was not found")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy install command" })).toBeTruthy();
  });
});

describe("discard", () => {
  it("does nothing on cancel and clears on confirm, with an undo", async () => {
    const user = userEvent.setup();
    addComment("t1", anchor, "fix this");
    addComment("t1", anchor, "and this");
    render(ChangesDrawer, { open: true });

    await user.click(await screen.findByRole("button", { name: "Discard" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard 2 review comments?" });
    expect(dialog.textContent).toContain("cannot be recovered");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Discard/ })).toBeNull());
    expect(get(activeSessionComments)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Discard" }));
    const again = await screen.findByRole("dialog", { name: "Discard 2 review comments?" });
    await user.click(within(again).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(get(activeSessionComments)).toHaveLength(0));

    const toast = get(toasts)[0];
    expect(toast?.action?.label).toBe("Undo");
    toast?.action?.run();
    expect(get(activeSessionComments).map((c) => c.body)).toEqual(["fix this", "and this"]);
  });
});

describe("Esc order", () => {
  it("closes the composer first and leaves the drawer to the window handler after", async () => {
    const user = userEvent.setup();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      render(ChangesDrawer, { open: true });
      await fireEvent.click(document.querySelector(".row.ins")!);
      const box = await screen.findByRole("textbox", { name: "Review comment" });

      await user.type(box, "{Escape}");
      expect(screen.queryByRole("textbox", { name: "Review comment" })).toBeNull();
      expect(onWindowKey).not.toHaveBeenCalled();
      expect(get(diffOpen)).toBe(true);

      // No composer: Esc bubbles to shortcuts.ts, and Modal does not act on it too.
      const toggle = await fileToggle();
      toggle.focus();
      await user.keyboard("{Escape}");
      expect(onWindowKey).toHaveBeenCalledTimes(1);
      expect(get(diffOpen)).toBe(true);
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});
