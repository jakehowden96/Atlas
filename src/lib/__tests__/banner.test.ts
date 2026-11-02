// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Banner from "../components/ui/Banner.svelte";

describe("Banner", () => {
  it("announces errors assertively and other tones politely", () => {
    render(Banner, { tone: "error", title: "Broke" });
    expect(screen.getByRole("alert").textContent).toContain("Broke");
    render(Banner, { tone: "info", title: "FYI" });
    expect(screen.getByRole("status").textContent).toContain("FYI");
  });

  it("dismisses through a named button", async () => {
    const ondismiss = vi.fn();
    render(Banner, { title: "Hi", ondismiss });
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });
});
