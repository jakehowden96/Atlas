// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

const logError = vi.fn();
vi.mock("../logger", () => ({
  log: { error: (...a: unknown[]) => logError(...a), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.3") }));
const writeText = vi.fn();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (t: string) => writeText(t),
}));
const revealLogsDir = vi.fn().mockResolvedValue(undefined);
vi.mock("../ipc", () => ({ revealLogsDir: () => revealLogsDir() }));

import Fixture from "./ErrorBoundaryFixture.svelte";

afterEach(() => {
  cleanup();
  logError.mockClear();
});

describe("ErrorBoundary", () => {
  it("shows the fallback, keeps siblings, and logs", () => {
    render(Fixture, { fail: { on: true } });
    expect(screen.getByRole("alert").textContent).toContain("Review hit a problem");
    expect(screen.getByText("sibling")).toBeTruthy();
    expect(logError).toHaveBeenCalledWith("ui", "Review crashed", expect.any(Error));
  });

  it("Reload view re-renders the children", async () => {
    const fail = { on: true };
    render(Fixture, { fail });
    fail.on = false;
    await fireEvent.click(screen.getByRole("button", { name: "Reload view" }));
    await tick();
    expect(screen.getByText("child ok")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Copy details includes message and version; Open logs calls ipc", async () => {
    render(Fixture, { fail: { on: true } });
    await tick();
    writeText.mockResolvedValue(undefined);
    await fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await tick();
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain("boom");
    expect(copied).toContain("1.2.3");
    await fireEvent.click(screen.getByRole("button", { name: "Open logs" }));
    expect(revealLogsDir).toHaveBeenCalled();
  });
});
