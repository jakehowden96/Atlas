// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import SetupBanners from "../components/shell/SetupBanners.svelte";
import { tailStaleMinutes } from "../components/session/rail/TailingNote.svelte";
import { claudeHookStale } from "../stores/claude";
import { claudeHook, tailTranscripts } from "../stores/settings";

const h = vi.hoisted(() => ({ info: vi.fn(), set: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<object>()), claudeInfo: h.info }));
vi.mock("../stores/settings", async (orig) => ({
  ...(await orig<object>()),
  setClaudeHookEnabled: h.set,
}));

const stale = { kind: "installed", upToDate: false };
const ok = { kind: "installed", upToDate: true };

afterEach(() => {
  cleanup();
  claudeHookStale.set(false);
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

describe("out-of-date hook banner", () => {
  it("offers Update, which reinstalls and refreshes", async () => {
    h.info.mockResolvedValueOnce({ notificationHook: ok, sessionStartHook: stale });
    h.info.mockResolvedValueOnce({ notificationHook: ok, sessionStartHook: ok });
    h.set.mockResolvedValue(undefined);
    render(SetupBanners);
    await fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    expect(h.set).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update" })).toBeNull());
  });

  it("stays hidden when hooks are current", async () => {
    h.info.mockResolvedValue({ notificationHook: ok, sessionStartHook: ok });
    render(SetupBanners);
    await waitFor(() => expect(h.info).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
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
