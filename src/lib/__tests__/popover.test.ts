// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import PopoverFixture from "./PopoverFixture.svelte";

afterEach(cleanup);

describe("Popover", () => {
  // Outside-click dismissal is bits-ui's and doesn't fire under happy-dom; checked in Storybook.
  it("opens as a named dialog, closes on Esc and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(PopoverFixture);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    await tick();
    expect(screen.getByRole("dialog", { name: "Options" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await tick();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Esc", async () => {
    const user = userEvent.setup();
    render(PopoverFixture);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await tick();
    await user.keyboard("{Escape}");
    await tick();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
