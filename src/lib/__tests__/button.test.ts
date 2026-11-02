// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import Button from "../components/ui/Button.svelte";
import IconButton from "../components/ui/IconButton.svelte";
import source from "../components/ui/Button.svelte?raw";

const children = createRawSnippet(() => ({ render: () => "<span>Save</span>" }));

afterEach(cleanup);

describe("Button", () => {
  it("renders by role and name and activates with Enter and Space", async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, { children, onclick });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onclick).toHaveBeenCalledTimes(2);
  });

  it("ignores clicks when disabled", async () => {
    const onclick = vi.fn();
    render(Button, { children, onclick, disabled: true });
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onclick).not.toHaveBeenCalled();
  });

  it("sets aria-busy and ignores clicks while loading", async () => {
    const onclick = vi.fn();
    render(Button, { children, onclick, loading: true });
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-busy")).toBe("true");
    await userEvent.setup().click(btn);
    expect(onclick).not.toHaveBeenCalled();
  });

  it("passes through attributes", () => {
    render(Button, { children, "data-x": "1" });
    expect(screen.getByRole("button").getAttribute("data-x")).toBe("1");
  });

  it("never removes the focus outline", () => {
    expect(source).not.toMatch(/outline:\s*none/);
  });
});

describe("IconButton", () => {
  it("uses label as the accessible name", () => {
    render(IconButton, { icon: "settings", label: "Settings" });
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("requires a label", () => {
    // @ts-expect-error label is required
    render(IconButton, { icon: "settings" });
  });
});
