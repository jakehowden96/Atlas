// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import Select from "../components/ui/Select.svelte";

afterEach(cleanup);

const options = [
  { id: "a", label: "Apple" },
  { id: "b", label: "Banana", disabled: true },
  { id: "c", label: "Cherry" },
  { id: "d", label: "Cranberry" },
];

function setup(props = {}) {
  const onChange = vi.fn();
  render(Select, { props: { options, onChange, "aria-label": "Fruit", ...props } });
  return { onChange, trigger: screen.getByRole("combobox", { name: "Fruit" }) };
}

describe("Select", () => {
  it("opens and closes, exposing combobox and listbox semantics", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    await tick();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(screen.getAllByRole("option")).toHaveLength(4);
    await user.click(trigger);
    await tick();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects by click", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = setup();
    await user.click(trigger);
    await tick();
    await user.click(screen.getByRole("option", { name: "Cherry" }));
    await tick();
    expect(onChange).toHaveBeenCalledWith("c");
    expect(trigger.textContent).toContain("Cherry");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("navigates by keyboard, skips disabled, updates aria-activedescendant, restores focus", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await tick();
    const first = screen.getByRole("option", { name: "Apple" });
    expect(trigger.getAttribute("aria-activedescendant")).toBe(first.id);
    await user.keyboard("{ArrowDown}");
    await tick();
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Cherry" }).id,
    );
    await user.keyboard("{End}");
    await tick();
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Cranberry" }).id,
    );
    await user.keyboard("{Home}");
    await tick();
    expect(trigger.getAttribute("aria-activedescendant")).toBe(first.id);
    await user.keyboard("{ArrowDown}{Enter}");
    await tick();
    expect(onChange).toHaveBeenCalledWith("c");
    expect(document.activeElement).toBe(trigger);
  });

  it("type-ahead moves to the matching option", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    trigger.focus();
    await user.keyboard("{Enter}");
    await tick();
    await user.keyboard("cra");
    await tick();
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Cranberry" }).id,
    );
  });

  it("Esc closes and restores focus; Tab closes", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await tick();
    await user.keyboard("{Escape}");
    await tick();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{ArrowDown}");
    await tick();
    await user.keyboard("{Tab}");
    await tick();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not open when disabled", async () => {
    const user = userEvent.setup();
    const { trigger } = setup({ disabled: true });
    await user.click(trigger);
    await tick();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
