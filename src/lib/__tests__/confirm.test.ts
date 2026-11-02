// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import ConfirmDialog, { confirmAction } from "../components/ui/ConfirmDialog.svelte";

afterEach(cleanup);

// happy-dom does no layout; Modal's tabbables() skips zero-size elements.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1 });

const props = {
  open: true,
  title: "Delete this session?",
  body: "The history is lost. This cannot be undone.",
  confirmLabel: "Delete session",
};

describe("ConfirmDialog", () => {
  it("is named by its question and focuses Cancel first", async () => {
    render(ConfirmDialog, { ...props, onConfirm() {}, onCancel() {} });
    expect(screen.getByRole("dialog", { name: "Delete this session?" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Cancel")));
  });

  it("confirms on Enter over the danger button", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(ConfirmDialog, { ...props, onConfirm, onCancel() {} });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete session" }));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("confirmAction", () => {
  it("resolves true on confirm and false on cancel", async () => {
    const user = userEvent.setup();
    const opts = { title: "Delete?", body: "Gone for good.", confirmLabel: "Delete" };
    const yes = confirmAction(opts);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await yes).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const no = confirmAction(opts);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await no).toBe(false);
  });
});
