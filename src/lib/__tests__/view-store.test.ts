import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";

import {
  activeView,
  diffOpen,
  newSessionOpen,
  newSessionSeed,
  openNewSession,
  showView,
} from "../stores/view";

describe("view store", () => {
  beforeEach(() => {
    activeView.set("sessions");
    diffOpen.set(false);
    newSessionOpen.set(false);
    newSessionSeed.set(null);
  });

  it("defaults to sessions", () => {
    expect(get(activeView)).toBe("sessions");
  });

  it("switches between the four views", () => {
    for (const v of ["session", "prs", "stats", "sessions"] as const) {
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

  it("opens the New Session modal unseeded by default", () => {
    openNewSession();
    expect(get(newSessionOpen)).toBe(true);
    expect(get(newSessionSeed)).toBeNull();
  });

  it("carries a Stats row's workspace and session into Resume mode", () => {
    openNewSession({ workspacePath: "/repo/atlas", resumeSessionId: "uuid-1" });
    expect(get(newSessionOpen)).toBe(true);
    expect(get(newSessionSeed)).toEqual({
      workspacePath: "/repo/atlas",
      resumeSessionId: "uuid-1",
    });
  });

  it("clears a previous seed on the next plain open", () => {
    openNewSession({ workspacePath: "/repo/atlas", resumeSessionId: "uuid-1" });
    openNewSession();
    expect(get(newSessionSeed)).toBeNull();
  });
});
