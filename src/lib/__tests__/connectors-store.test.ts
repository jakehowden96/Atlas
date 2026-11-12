// @vitest-environment happy-dom
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorState } from "../../types/generated/ConnectorState";

type Handler = (payload: never) => void;
const handlers = vi.hoisted(() => ({}) as Record<string, Handler>);
const ipc = vi.hoisted(() => ({
  connectorList: vi.fn(),
  connectorConnect: vi.fn(),
  connectorCancel: vi.fn(),
  connectorDisconnect: vi.fn(),
  connectorLinkCli: vi.fn(),
  onConnectorStatus: vi.fn(async (cb: Handler) => {
    handlers.status = cb;
    return () => {};
  }),
  onConnectorProgress: vi.fn(async (cb: Handler) => {
    handlers.progress = cb;
    return () => {};
  }),
  onConnectorDeviceCode: vi.fn(async (cb: Handler) => {
    handlers.deviceCode = cb;
    return () => {};
  }),
}));
vi.mock("../ipc", () => ipc);
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { needsReconnectLabel, openOnProviderLabel } from "../connectors";
import {
  byKind,
  cancel,
  connect,
  connectors,
  disconnect,
  reconnect,
  needsReconnect,
  offlineSince,
  online,
  signIn,
  startConnectorEvents,
} from "../stores/connectors";

const state = (
  id: string,
  kind: "tickets" | "pullRequests",
  status: ConnectorState["status"],
): ConnectorState => ({
  info: {
    id,
    name: id === "github" ? "GitHub" : "Linear",
    kind,
    flow: "browser",
    methods: ["oauth"],
    configured: true,
  },
  status,
  method: status.kind === "notLinked" ? null : "oauth",
});
const linear = state("linear", "tickets", { kind: "linked", account: "a" });
const github = state("github", "pullRequests", { kind: "notLinked" });

let stop: () => void;
beforeEach(async () => {
  vi.clearAllMocks();
  ipc.connectorList.mockResolvedValue([linear, github]);
  connectors.set([]);
  signIn.set({ kind: "idle" });
  offlineSince.set(null);
  stop = await startConnectorEvents();
});
afterEach(() => stop());

describe("connectors store", () => {
  it("loads the list on start and derives byKind", async () => {
    await vi.waitFor(() => expect(get(connectors)).toHaveLength(2));
    expect(get(byKind).tickets?.info.id).toBe("linear");
    expect(get(byKind).pullRequests).toBeNull();
  });

  it("is idempotent", async () => {
    expect(await startConnectorEvents()).toBe(stop);
    expect(ipc.onConnectorStatus).toHaveBeenCalledTimes(1);
  });

  it("applies status events and derives needsReconnect", async () => {
    await vi.waitFor(() => expect(get(connectors)).toHaveLength(2));
    handlers.status?.({
      connector: "linear",
      status: { kind: "reconnectNeeded", reason: "expired" },
    } as never);
    expect(get(needsReconnect).map((c) => c.info.id)).toEqual(["linear"]);
    expect(get(byKind).tickets).toBeNull();
    expect(needsReconnectLabel(get(needsReconnect)[0]!)).toBe("Linear needs reconnecting");
    expect(openOnProviderLabel(github)).toBe("Open on GitHub");
  });

  it("walks the browser flow", async () => {
    let finish: () => void = () => {};
    ipc.connectorConnect.mockReturnValue(new Promise<void>((r) => (finish = r)));
    const done = connect("linear");
    expect(get(signIn).kind).toBe("starting");
    handlers.progress?.({ phase: "opened" } as never);
    expect(get(signIn).kind).toBe("waitingBrowser");
    handlers.progress?.({ phase: "exchanging" } as never);
    expect(get(signIn).kind).toBe("exchanging");
    finish();
    await done;
    expect(get(signIn).kind).toBe("idle");
  });

  it("walks the device-code flow and keeps expiry visible", async () => {
    let finish: () => void = () => {};
    ipc.connectorConnect.mockReturnValue(new Promise<void>((r) => (finish = r)));
    const done = connect("github");
    handlers.deviceCode?.({
      userCode: "ABCD",
      verificationUri: "https://x/device",
      expiresIn: 60,
    } as never);
    handlers.progress?.({ phase: "waiting", expiresAt: 123 } as never);
    expect(get(signIn)).toMatchObject({ kind: "deviceCode", userCode: "ABCD", expiresAt: 123 });
    handlers.progress?.({ phase: "expired" } as never);
    finish();
    await done;
    expect(get(signIn).kind).toBe("expired");
  });

  it("shows denied and failed", async () => {
    handlers.progress?.({ phase: "denied" } as never);
    expect(get(signIn).kind).toBe("denied");
    handlers.progress?.({ phase: "failed", message: "boom" } as never);
    expect(get(signIn)).toEqual({ kind: "failed", reason: "boom" });
  });

  it("fails when connect rejects", async () => {
    ipc.connectorConnect.mockRejectedValue(new Error("no"));
    await connect("linear");
    expect(get(signIn)).toEqual({ kind: "failed", reason: "no" });
  });

  it("cancel resets to idle", async () => {
    signIn.set({ kind: "waitingBrowser" });
    await cancel("linear");
    expect(get(signIn).kind).toBe("idle");
    expect(ipc.connectorCancel).toHaveBeenCalledWith("linear");
  });

  it("reconnects each connector the way it was linked", async () => {
    ipc.connectorConnect.mockResolvedValue(undefined);
    ipc.connectorLinkCli.mockResolvedValue(undefined);
    const expired = { kind: "reconnectNeeded", reason: "x" } as const;
    await reconnect({ ...github, status: expired, method: "cli" });
    expect(ipc.connectorLinkCli).toHaveBeenCalledWith("github");
    expect(ipc.connectorConnect).not.toHaveBeenCalled();
    await reconnect({ ...github, status: expired, method: "apiKey" });
    expect(ipc.connectorConnect).not.toHaveBeenCalled();
    await reconnect({ ...github, status: expired, method: "oauth" });
    expect(ipc.connectorConnect).toHaveBeenCalledWith("github");
  });

  it("disconnect refreshes the list", async () => {
    ipc.connectorList.mockResolvedValue([github]);
    await disconnect("linear");
    expect(ipc.connectorDisconnect).toHaveBeenCalledWith("linear");
    expect(get(connectors)).toEqual([github]);
  });

  it("tracks offline from window events and failed fetches", async () => {
    window.dispatchEvent(new Event("offline"));
    expect(get(online)).toBe(false);
    expect(get(offlineSince)).not.toBeNull();
    window.dispatchEvent(new Event("online"));
    expect(get(online)).toBe(true);
    ipc.connectorList.mockRejectedValue({ kind: "connectorOffline" });
    await disconnect("linear");
    expect(get(online)).toBe(false);
  });
});
