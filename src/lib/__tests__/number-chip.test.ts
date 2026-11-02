// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChipInput from "../components/ui/ChipInput.svelte";
import NumberStepper from "../components/ui/NumberStepper.svelte";

afterEach(cleanup);

describe("NumberStepper", () => {
  function setup(value = 10) {
    const onChange = vi.fn();
    render(NumberStepper, { value, min: 8, max: 30, step: 1, label: "Font size", onChange });
    return { onChange, spin: screen.getByRole("spinbutton") };
  }

  it("exposes spinbutton aria values", () => {
    const { spin } = setup();
    expect(spin.getAttribute("aria-valuenow")).toBe("10");
    expect(spin.getAttribute("aria-valuemin")).toBe("8");
    expect(spin.getAttribute("aria-valuemax")).toBe("30");
  });

  it.each([
    ["ArrowUp", 11],
    ["ArrowDown", 9],
    ["PageUp", 20],
    ["PageDown", 8],
    ["Home", 8],
    ["End", 30],
  ])("%s sets %i", async (key, expected) => {
    const { onChange, spin } = setup();
    await fireEvent.keyDown(spin, { key });
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(spin.getAttribute("aria-valuenow")).toBe(String(expected));
  });

  it("buttons step and disable at bounds", async () => {
    const { onChange } = setup(8);
    expect((screen.getByRole("button", { name: /Decrease/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await fireEvent.click(screen.getByRole("button", { name: /Increase/ }));
    expect(onChange).toHaveBeenCalledWith(9);
  });
});

describe("ChipInput", () => {
  const validate = (v: string) => (v.includes("/") ? null : "Use owner/name");
  const live = () => document.querySelector("[aria-live=polite]")?.textContent;

  it("Enter and comma add chips and announce", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(ChipInput, { value: [], label: "Repos", onChange });
    await user.type(screen.getByLabelText("Repos"), "a/b{Enter}c/d,");
    expect(onChange).toHaveBeenLastCalledWith(["a/b", "c/d"]);
    expect(screen.getByRole("button", { name: "Remove a/b" })).toBeTruthy();
    expect(live()).toBe("Added c/d");
  });

  it("Backspace on empty removes the last chip", async () => {
    const user = userEvent.setup();
    render(ChipInput, { value: ["a/b", "c/d"], label: "Repos" });
    await user.type(screen.getByLabelText("Repos"), "{Backspace}");
    expect(screen.queryByRole("button", { name: "Remove c/d" })).toBeNull();
    expect(live()).toBe("Removed c/d");
  });

  it("remove button removes a chip", async () => {
    const user = userEvent.setup();
    render(ChipInput, { value: ["a/b"], label: "Repos" });
    await user.click(screen.getByRole("button", { name: "Remove a/b" }));
    expect(screen.queryByRole("button", { name: "Remove a/b" })).toBeNull();
  });

  it("paste splits on whitespace and commas", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(ChipInput, { value: [], label: "Repos", onChange });
    await user.click(screen.getByLabelText("Repos"));
    await user.paste("a/b c/d,e/f");
    expect(onChange).toHaveBeenLastCalledWith(["a/b", "c/d", "e/f"]);
  });

  it("rejects duplicates", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(ChipInput, { value: ["a/b"], label: "Repos", onChange });
    await user.type(screen.getByLabelText("Repos"), "a/b{Enter}");
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("already added");
  });

  it("shows validation only after first blur, then live", async () => {
    const user = userEvent.setup();
    render(ChipInput, { value: [], label: "Repos", validate });
    const input = screen.getByLabelText("Repos");
    await user.type(input, "bad");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.tab();
    expect(screen.getByRole("alert").textContent).toContain("Use owner/name");
    await user.click(input);
    await user.type(input, "/x");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
