// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Harness from "./HarnessFixture.svelte";

describe("component harness", () => {
  it("mounts, queries by role, and handles Tab and Enter", async () => {
    const user = userEvent.setup();
    render(Harness);
    const btn = screen.getByRole("button", { name: "Count 0" });
    await user.tab();
    expect(document.activeElement).toBe(btn);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Count 1" })).toBe(btn);
  });
});
