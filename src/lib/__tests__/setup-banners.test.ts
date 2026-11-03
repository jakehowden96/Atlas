// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import SetupBanners from "../components/shell/SetupBanners.svelte";
import { tailStaleMinutes } from "../components/session/rail/TailingNote.svelte";
import { claudeHook, tailTranscripts } from "../stores/settings";

afterEach(() => {
  cleanup();
  claudeHook.set(true);
  tailTranscripts.set(true);
});

describe("SetupBanners", () => {
  it("shows nothing when hooks and tailing are on", () => {
    render(SetupBanners);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers fixes when hooks and tailing are off", () => {
    claudeHook.set(false);
    tailTranscripts.set(false);
    render(SetupBanners);
    expect(screen.getByRole("button", { name: "Install hooks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
  });
});

describe("tailStaleMinutes", () => {
  const now = Date.parse("2026-01-01T00:10:00Z");
  it("is null for fresh, non-running or unknown activity", () => {
    expect(tailStaleMinutes("running", "2026-01-01T00:09:30Z", now)).toBeNull();
    expect(tailStaleMinutes("idle", "2026-01-01T00:00:00Z", now)).toBeNull();
    expect(tailStaleMinutes("needsYou", "2026-01-01T00:00:00Z", now)).toBeNull();
    expect(tailStaleMinutes("running", null, now)).toBeNull();
  });
  it("counts whole minutes for a quiet running session", () => {
    expect(tailStaleMinutes("running", "2026-01-01T00:07:00Z", now)).toBe(3);
    expect(tailStaleMinutes("running", "2026-01-01T00:07:50Z", now)).toBe(2);
  });
});
