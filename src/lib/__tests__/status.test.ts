// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import StatusMark from "../components/app/common/StatusMark.svelte";
import StatePill from "../components/app/common/StatePill.svelte";

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
