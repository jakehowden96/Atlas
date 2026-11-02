// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
  setClaudeHook: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import Harnesses from "../components/settings/sections/Harnesses.svelte";
import { DEFAULT_HARNESSES, harnesses } from "../stores/settings";
import { toasts } from "../stores/toast";

beforeEach(() => {
  vi.clearAllMocks();
  toasts.set([]);
  harnesses.set([...DEFAULT_HARNESSES]);
});
afterEach(cleanup);

describe("Settings > Harnesses", () => {
  it("remove then Undo restores the harness at its position", async () => {
    const before = get(harnesses).map((h) => h.id);
    render(Harnesses);
    await fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0] as HTMLElement);
    await vi.waitFor(() => expect(get(harnesses).map((h) => h.id)).toEqual(before.slice(1)));
    await vi.waitFor(() => expect(get(toasts)).toHaveLength(1));
    get(toasts)[0]?.action?.run();
    await vi.waitFor(() => expect(get(harnesses).map((h) => h.id)).toEqual(before));
  });

  it("a committed edit shows Saved", async () => {
    render(Harnesses);
    await fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    const label = screen.getByLabelText("Label") as HTMLInputElement;
    await fireEvent.input(label, { target: { value: "Renamed" } });
    await fireEvent.blur(label);
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(get(harnesses)[0]?.label).toBe("Renamed");
  });

  it("the last harness cannot be removed", () => {
    harnesses.set(DEFAULT_HARNESSES.slice(0, 1));
    render(Harnesses);
    expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
