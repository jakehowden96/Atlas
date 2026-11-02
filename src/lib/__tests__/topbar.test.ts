// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import TopBar from "../components/shell/TopBar.svelte";
import { statusParts, topBarTier } from "../topbar";

const c = { running: 2, needsYou: 1, idle: 3, spend: 4.5 };

describe("status line tiers", () => {
  it("picks a tier from width", () => {
    expect(topBarTier(1400)).toBe("full");
    expect(topBarTier(1399)).toBe("mid");
    expect(topBarTier(1100)).toBe("mid");
    expect(topBarTier(1099)).toBe("compact");
    expect(topBarTier(800)).toBe("compact");
  });

  it("shows all counts at full, running and needs-you below", () => {
    expect(statusParts("full", c).map((p) => p.text)).toEqual([
      "2 running",
      "1 needs you",
      "3 idle",
      "$4.50 today",
    ]);
    expect(statusParts("mid", c).map((p) => p.text)).toEqual(["2 running", "1 needs you"]);
    expect(statusParts("compact", c)).toHaveLength(2);
  });
});

describe("TopBar", () => {
  afterEach(cleanup);
  it("exposes the view switch as tabs", () => {
    render(TopBar);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tab").length).toBe(4);
  });
});
