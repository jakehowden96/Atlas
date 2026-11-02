// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Fixture from "./FieldFixture.svelte";
import SearchInput from "../components/ui/SearchInput.svelte";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("Field", () => {
  it("associates the label and links help via describedby", () => {
    render(Fixture, { help: "Shown in the rail" });
    const input = screen.getByLabelText("Name");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByText("Shown in the rail").id);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the error instead of help and marks the control invalid", () => {
    render(Fixture, { help: "Shown in the rail", error: "Required" });
    const input = screen.getByLabelText("Name");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByText(/Required/).id);
    expect(screen.queryByText("Shown in the rail")).toBeNull();
  });

  it("shows the saved tick for 2 seconds", async () => {
    vi.useFakeTimers();
    render(Fixture, { saved: true });
    expect(await screen.findByText(/Saved/)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2001);
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it("commits on blur and on Enter", async () => {
    const user = userEvent.setup();
    const oncommit = vi.fn();
    render(Fixture, { oncommit });
    await user.type(screen.getByLabelText("Name"), "abc{Enter}");
    expect(oncommit).toHaveBeenLastCalledWith("abc");
    oncommit.mockClear();
    await user.tab();
    expect(oncommit).toHaveBeenCalledWith("abc");
  });

  it("does not take focus when disabled", async () => {
    const user = userEvent.setup();
    render(Fixture, { disabled: true });
    await user.tab();
    expect(document.activeElement).not.toBe(screen.getByLabelText("Name"));
  });
});

describe("SearchInput", () => {
  it("Esc clears, then blurs", async () => {
    const user = userEvent.setup();
    render(SearchInput, { value: "foo", "aria-label": "Search" });
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    await user.click(box);
    await user.keyboard("{Escape}");
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
    await user.keyboard("{Escape}");
    expect(document.activeElement).not.toBe(box);
  });

  it("clear button empties and hides itself", async () => {
    const user = userEvent.setup();
    render(SearchInput, { value: "foo", "aria-label": "Search" });
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});
