// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { get, type Writable } from "svelte/store";

vi.mock("../ipc", () => ({ listPlans: vi.fn(async () => []), listDocs: vi.fn(async () => []) }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../session-actions", () => ({ openSession: vi.fn() }));
vi.mock("../stores/liveTiles", async () => {
  const { writable } = await import("svelte/store");
  return { liveTiles: writable([]) };
});

import JumpPalette from "../components/session/JumpPalette.svelte";
import { liveTiles } from "../stores/liveTiles";
import { newSessionOpen, jumpOpen, focusedSessionId } from "../stores/view";
import { docEntries, plans } from "../stores/files";
import { prRepos } from "../stores/prs";

Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });
Element.prototype.scrollIntoView = () => {};

function tile(uuid: string, label: string) {
  return {
    sessionUuid: uuid,
    atlasSessionId: `a-${uuid}`,
    label,
    workspaceName: "atlas",
    workspacePath: "",
    branch: "main",
    state: "idle",
  };
}

beforeEach(() => {
  (liveTiles as unknown as Writable<unknown>).set([tile("1", "Alpha"), tile("2", "Beta")]);
  docEntries.set([]);
  plans.set([{ name: "zzz", path: "/p/zzz" }] as never);
  prRepos.set([]);
  newSessionOpen.set(false);
  focusedSessionId.set("");
  jumpOpen.set(true);
});
afterEach(() => {
  cleanup();
  jumpOpen.set(false);
});

describe("JumpPalette", () => {
  it("exposes combobox, listbox and options", async () => {
    render(JumpPalette);
    const box = await screen.findByRole("combobox");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox").id).toBe(box.getAttribute("aria-controls"));
    expect(screen.getAllByRole("option").length).toBe(3);
  });

  it("moves aria-activedescendant with the arrows and Enter opens the row", async () => {
    render(JumpPalette);
    const box = await screen.findByRole("combobox");
    const opts = screen.getAllByRole("option");
    expect(box.getAttribute("aria-activedescendant")).toBe(opts[0]!.id);
    await fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(opts[1]!.id);
    expect(opts[1]!.getAttribute("aria-selected")).toBe("true");
    await fireEvent.keyDown(box, { key: "Enter" });
    expect(get(focusedSessionId)).toBe("a-2");
  });

  it("shows no-match and Ctrl+Enter starts a new session", async () => {
    render(JumpPalette);
    const box = await screen.findByRole("combobox");
    await fireEvent.input(box, { target: { value: "qqqqq" } });
    expect(screen.queryAllByRole("option").length).toBe(0);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    await fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(get(newSessionOpen)).toBe(true);
  });
});
