// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

const writeText = vi.fn();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: (t: string) => writeText(t) }));
vi.mock("../logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { copyText } from "../ui/copy";
import CopyButton from "../components/ui/CopyButton.svelte";

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("copyText", () => {
  it("returns true on success and false on failure without throwing", async () => {
    writeText.mockResolvedValueOnce(undefined);
    expect(await copyText("a")).toBe(true);
    writeText.mockRejectedValueOnce(new Error("x"));
    expect(await copyText("a")).toBe(false);
  });

  it("falls back to navigator.clipboard", async () => {
    writeText.mockRejectedValueOnce(new Error("x"));
    const nav = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: nav },
      configurable: true,
    });
    expect(await copyText("b")).toBe(true);
    expect(nav).toHaveBeenCalledWith("b");
  });
});

describe("CopyButton", () => {
  it("shows Copied, announces it, and resets after 2s", async () => {
    vi.useFakeTimers();
    writeText.mockResolvedValue(undefined);
    const { container } = render(CopyButton, { value: "v" });
    await fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Copied");
    await vi.advanceTimersByTimeAsync(2000);
    await tick();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("shows a failure message and still resets", async () => {
    vi.useFakeTimers();
    writeText.mockRejectedValue(new Error("x"));
    const { container } = render(CopyButton, { value: "v", variant: "text" });
    await fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(screen.getByRole("button", { name: "Couldn't copy" })).toBeTruthy();
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Couldn't copy");
    await vi.advanceTimersByTimeAsync(2000);
    await tick();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});
