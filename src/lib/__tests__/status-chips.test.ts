// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({}));
vi.mock("../updater", async () => {
  const { writable } = await import("svelte/store");
  return { updateState: writable({ kind: "notConfigured" }), installUpdate: vi.fn() };
});

import StatusChips, { statusChipCount } from "../components/shell/StatusChips.svelte";
import { connectors, offlineSince } from "../stores/connectors";
import { prRepos, refreshPrs } from "../stores/prs";
import { notificationLog } from "../stores/toast";
import { updateState } from "../updater";

const conn = (id: string, kind: "linked" | "reconnectNeeded") =>
  ({
    info: {
      id,
      name: id === "github" ? "GitHub" : "Linear",
      kind: "pullRequests",
      flow: "oauth",
      configured: true,
    },
    status: kind === "linked" ? { kind, account: "a" } : { kind, reason: "expired" },
  }) as never;

beforeEach(() => {
  offlineSince.set(null);
  connectors.set([]);
  updateState.set({ kind: "notConfigured" });
  notificationLog.set([]);
});
afterEach(cleanup);

describe("StatusChips", () => {
  it("shows nothing when healthy", () => {
    render(StatusChips);
    expect(screen.queryByRole("status")).toBeNull();
    expect(get(statusChipCount)).toBe(0);
  });

  it("shows the offline chip once", () => {
    offlineSince.set(1);
    render(StatusChips);
    expect(screen.getAllByText(/^Offline/)).toHaveLength(1);
    expect(get(statusChipCount)).toBe(1);
  });

  it("shows one reconnect chip per expired connector and drops it when healthy", async () => {
    connectors.set([conn("github", "reconnectNeeded"), conn("linear", "linked")]);
    render(StatusChips);
    expect(screen.getAllByRole("button", { name: /needs reconnecting/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "GitHub needs reconnecting" })).toBeTruthy();
    connectors.set([conn("github", "linked")]);
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: /needs reconnecting/ })).toBeNull();
  });

  it("shows the update chip only when available", async () => {
    updateState.set({ kind: "upToDate" });
    render(StatusChips);
    expect(screen.queryByText("Update ready")).toBeNull();
    updateState.set({ kind: "available", version: "1.2.3", notes: "", date: "" });
    await Promise.resolve();
    expect(screen.getByText("Update ready")).toBeTruthy();
  });
});

describe("offline toast suppression", () => {
  it("does not toast a failed PR refresh while offline", async () => {
    prRepos.set(null);
    offlineSince.set(1);
    await refreshPrs();
    expect(get(notificationLog)).toHaveLength(0);
  });
});
