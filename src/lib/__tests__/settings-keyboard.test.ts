// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import Keyboard from "../components/settings/sections/Keyboard.svelte";
import { DEFAULT_KEYMAP } from "../keymap";
import { keymap } from "../stores/settings";

afterEach(() => {
  cleanup();
  keymap.set({ ...DEFAULT_KEYMAP });
});

describe("Settings Keyboard section", () => {
  it("shows no conflict banner for the defaults", () => {
    render(Keyboard);
    expect(screen.queryByText(/share a chord/)).toBeNull();
  });

  it("marks clashing rows and shows the warn banner", () => {
    keymap.set({ ...DEFAULT_KEYMAP, newSession: [...DEFAULT_KEYMAP.jump] });
    render(Keyboard);
    expect(screen.getByText(/Two actions share a chord/)).toBeTruthy();
    expect(screen.getAllByText("Another action uses this chord").length).toBe(2);
  });
});
