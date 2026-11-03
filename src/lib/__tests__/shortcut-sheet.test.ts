// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import ShortcutSheet from "../components/settings/ShortcutSheet.svelte";
import { ACTIONS, ACTION_LABELS } from "../keymap";
import { shortcutsOpen } from "../stores/view";

afterEach(cleanup);

it("lists every keymap action", () => {
  shortcutsOpen.set(true);
  render(ShortcutSheet);
  for (const a of ACTIONS) expect(screen.getAllByText(ACTION_LABELS[a]).length).toBeGreaterThan(0);
  shortcutsOpen.set(false);
});
