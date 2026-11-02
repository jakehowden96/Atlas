// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createRawSnippet } from "svelte";
import { render, screen } from "@testing-library/svelte";
import StatusMark from "../components/ui/StatusMark.svelte";
import Kbd from "../components/ui/Kbd.svelte";
import Chip from "../components/ui/Chip.svelte";
import StatePill from "../components/ui/StatePill.svelte";

const states = ["running", "failing", "attention", "done", "idle"] as const;

describe("StatusMark", () => {
  it.each(states)("%s renders its shape class and is decorative by default", (state) => {
    const { container } = render(StatusMark, { state });
    const el = container.querySelector(".mark") as HTMLElement;
    expect(el.classList.contains(state)).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it.each(states)("%s with a label has role img and a name", (state) => {
    render(StatusMark, { state, label: `is ${state}` });
    expect(screen.getByRole("img", { name: `is ${state}` })).toBeTruthy();
  });
});

describe("StatePill", () => {
  it("maps needs onto the attention shape with its word", () => {
    const { container } = render(StatePill, { state: "needs" });
    expect(container.querySelector(".mark.attention")).toBeTruthy();
    expect(container.textContent).toContain("Needs you");
  });
});

describe("Kbd", () => {
  it("renders one kbd style, with an ink variant by prop", () => {
    const children = createRawSnippet(() => ({ render: () => "<span>K</span>" }));
    const { container } = render(Kbd, { children, onInk: true });
    const el = container.querySelector("kbd") as HTMLElement;
    expect(el.classList.contains("on-ink")).toBe(true);
  });
});

describe("Chip", () => {
  it("reflects selection via aria-pressed", () => {
    render(Chip, { label: "A", onClick: () => {}, selected: true });
    render(Chip, { label: "B", onClick: () => {} });
    expect(screen.getByRole("button", { name: "A" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "B" }).getAttribute("aria-pressed")).toBe("false");
  });
});
