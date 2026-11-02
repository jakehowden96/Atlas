// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";

const resolve = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../stores/files", async () => {
  const { writable } = await import("svelte/store");
  return {
    closeRequest: writable({ kind: "tab", key: "disk:/a/notes.md" }),
    dirtyFiles: writable(new Set<string>()),
    resolveCloseRequest: resolve,
  };
});

import UnsavedDialog from "../components/files/UnsavedDialog.svelte";

afterEach(() => {
  cleanup();
  resolve.mockClear();
});

// happy-dom does no layout; Modal's tabbables() skips zero-size elements.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });

describe("UnsavedDialog", () => {
  it("is named and focuses Cancel first", async () => {
    render(UnsavedDialog);
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })),
    );
  });

  it("Esc cancels exactly once", async () => {
    const user = userEvent.setup();
    render(UnsavedDialog);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })),
    );
    await user.keyboard("{Escape}");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("cancel");
  });
});
