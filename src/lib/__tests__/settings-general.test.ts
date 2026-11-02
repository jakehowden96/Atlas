// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
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

import General from "../components/settings/sections/General.svelte";
import { MAX_TERMINAL_FONT_SIZE, terminalFontSize } from "../stores/settings";

afterEach(cleanup);

describe("Settings General", () => {
  it("stepper changes the font size within bounds", async () => {
    terminalFontSize.set(MAX_TERMINAL_FONT_SIZE - 1);
    render(General);
    const inc = screen.getByRole("button", { name: /increase|larger|\+/i });
    await fireEvent.click(inc);
    expect(get(terminalFontSize)).toBe(MAX_TERMINAL_FONT_SIZE);
    await fireEvent.click(inc);
    expect(get(terminalFontSize)).toBe(MAX_TERMINAL_FONT_SIZE);
  });
});
