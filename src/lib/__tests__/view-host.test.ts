// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

vi.mock("../logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.3") }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("../ipc", () => ({ revealLogsDir: vi.fn() }));

// Only Stats throws; the other views are inert stand-ins.
const fail = vi.hoisted(() => ({ on: true }));
vi.mock("../components/stats/StatsView.svelte", async () => {
  const { default: Thrower } = await import("./ThrowerFixture.svelte");
  return { default: (anchor: never) => Thrower(anchor, { fail }) };
});
vi.mock("../components/files/FilesView.svelte", () => ({ default: () => {} }));
vi.mock("../components/prs/PrsView.svelte", () => ({ default: () => {} }));
vi.mock("../components/session/SessionView.svelte", () => ({ default: () => {} }));
vi.mock("../components/sessions/SessionsView.svelte", () => ({ default: () => {} }));

import ViewHost from "../components/shell/ViewHost.svelte";
import { activeView } from "../stores/view";

afterEach(cleanup);

describe("ViewHost", () => {
  it("a crash in Stats shows the fallback and Reload view recovers", async () => {
    fail.on = true;
    activeView.set("stats");
    render(ViewHost);
    expect(screen.getByRole("alert").textContent).toContain("Stats hit a problem");
    fail.on = false;
    await fireEvent.click(screen.getByRole("button", { name: "Reload view" }));
    await tick();
    expect(screen.getByText("child ok")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("other views are unaffected by the Stats crash", () => {
    fail.on = true;
    activeView.set("files");
    render(ViewHost);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
