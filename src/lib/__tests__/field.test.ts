// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import SearchInput from "../components/app/common/SearchInput.svelte";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
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
