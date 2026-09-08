import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";

import { activeView, diffOpen, showView } from "../stores/view";

describe("view store", () => {
  beforeEach(() => {
    activeView.set("overview");
    diffOpen.set(false);
  });

  it("defaults to overview", () => {
    expect(get(activeView)).toBe("overview");
  });

  it("switches between the four views", () => {
    for (const v of ["session", "prs", "stats", "overview"] as const) {
      showView(v);
      expect(get(activeView)).toBe(v);
    }
  });

  it("keeps the changes drawer open while staying in Session view", () => {
    showView("session");
    diffOpen.set(true);
    showView("session");
    expect(get(diffOpen)).toBe(true);
  });

  it("closes the changes drawer when leaving Session view", () => {
    showView("session");
    diffOpen.set(true);
    showView("prs");
    expect(get(diffOpen)).toBe(false);
  });
});
