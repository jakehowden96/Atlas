import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SegmentedControl, { type Segment } from "../components/ui/SegmentedControl.svelte";

const options: Segment[] = [
  { id: "a", label: "One" },
  { id: "b", label: "Two", disabled: true },
  { id: "c", label: "Three", count: 3, alert: true },
  { id: "d", label: "Four", dot: true },
];

describe("SegmentedControl", () => {
  it("renders tablist with aria-selected and roving tabindex", () => {
    render(SegmentedControl, { options, value: "a", onChange: () => {} });
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Three/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "One" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: /Three/ }).tabIndex).toBe(-1);
  });

  it("renders radiogroup with aria-checked", () => {
    render(SegmentedControl, { options, value: "c", onChange: () => {}, role: "radiogroup" });
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Three/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "One" }).getAttribute("aria-checked")).toBe("false");
  });

  it("moves and selects with arrows, skipping disabled, plus Home and End", async () => {
    const onChange = vi.fn();
    render(SegmentedControl, { options, value: "a", onChange });
    const user = userEvent.setup();
    screen.getByRole("tab", { name: "One" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("d");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("disabled segments are disabled", () => {
    render(SegmentedControl, { options, value: "a", onChange: () => {} });
    expect((screen.getByRole("tab", { name: "Two" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("announces count, alert and dot in the accessible name", () => {
    render(SegmentedControl, { options, value: "a", onChange: () => {} });
    expect(screen.getByRole("tab", { name: /Three\s*3\s*need attention/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Four\s*needs attention/ })).toBeTruthy();
  });
});
