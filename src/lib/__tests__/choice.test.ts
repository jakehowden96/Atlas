// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Checkbox from "../components/ui/Checkbox.svelte";
import RadioGroup from "../components/ui/RadioGroup.svelte";
import Toggle from "../components/ui/Toggle.svelte";

afterEach(cleanup);

const options = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

describe("Checkbox", () => {
  it("toggles with Space and exposes state", async () => {
    const user = userEvent.setup();
    render(Checkbox, { label: "Agree" });
    const cb = screen.getByRole("checkbox", { name: "Agree" }) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    await user.tab();
    await user.keyboard(" ");
    expect(cb.checked).toBe(true);
  });

  it("is indeterminate until toggled", async () => {
    const user = userEvent.setup();
    render(Checkbox, { label: "Some", indeterminate: true });
    const cb = screen.getByRole("checkbox", { name: "Some" }) as HTMLInputElement;
    expect(cb.indeterminate).toBe(true);
    await user.click(cb);
    expect(cb.indeterminate).toBe(false);
  });
});

describe("RadioGroup", () => {
  it("has radio roles and correct aria-checked", () => {
    render(RadioGroup, { options, value: "b", label: "Pick" });
    expect(screen.getByRole("radiogroup", { name: "Pick" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r: HTMLElement) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("is a single tab stop and moves with arrow keys", async () => {
    const user = userEvent.setup();
    render(RadioGroup, { options, value: "a" });
    const [a, b, c] = screen.getAllByRole("radio") as [HTMLElement, HTMLElement, HTMLElement];
    expect([a, b, c].map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    await user.tab();
    expect(document.activeElement).toBe(a);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(c);
    expect(c.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Toggle", () => {
  it("is a switch that Space toggles", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(Toggle, { checked: false, onChange, label: "Sound" });
    const sw = screen.getByRole("switch", { name: "Sound" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await user.tab();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
