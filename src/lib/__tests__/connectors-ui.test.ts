// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  connectorList: vi.fn(async () => []),
  connectorConnect: vi.fn(() => new Promise(() => {})),
  connectorCancel: vi.fn(async () => {}),
  connectorDisconnect: vi.fn(async () => {}),
  onConnectorStatus: vi.fn(),
  onConnectorProgress: vi.fn(),
  onConnectorDeviceCode: vi.fn(),
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { connectorConnect, connectorDisconnect } from "../ipc";
import Connectors from "../components/settings/sections/Connectors.svelte";
import { connectors, signIn } from "../stores/connectors";
import { watchedRepos } from "../stores/settings";
import type { ConnectorState } from "../../types/generated/ConnectorState";

const mk = (
  id: string,
  kind: "tickets" | "pullRequests",
  flow: "browser" | "deviceCode",
  status: ConnectorState["status"] = { kind: "notLinked" },
  configured = true,
): ConnectorState => ({ info: { id, name: `Name ${id}`, kind, flow, configured }, status });

beforeEach(() => {
  vi.clearAllMocks();
  signIn.set({ kind: "idle" });
  watchedRepos.set([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("connector rows", () => {
  it("shows each state with its actions", () => {
    connectors.set([
      mk("a", "tickets", "browser"),
      mk("b", "tickets", "browser", { kind: "linked", account: "me" }),
      mk("c", "tickets", "browser", { kind: "reconnectNeeded", reason: "expired" }),
      mk("d", "tickets", "browser", { kind: "error", message: "boom" }),
      mk("e", "tickets", "browser", { kind: "notLinked" }, false),
    ]);
    render(Connectors);
    expect(screen.getByText("Linked as me")).toBeTruthy();
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    expect(screen.getByText("Error: boom")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("Not configured in this build")).toBeTruthy();
    const connect = screen.getAllByRole("button", { name: "Connect" }) as HTMLButtonElement[];
    expect(connect.map((b) => b.disabled)).toEqual([false, true]);
  });
});

describe("sign-in dialogs", () => {
  it("starts the browser flow", async () => {
    connectors.set([mk("a", "tickets", "browser")]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(connectorConnect).toHaveBeenCalledWith("a");
    expect(await screen.findByText("Finish in your browser")).toBeTruthy();
  });

  it("counts down in the device dialog and warns under a minute", async () => {
    connectors.set([mk("a", "pullRequests", "deviceCode")]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    signIn.set({
      kind: "deviceCode",
      userCode: "ABCD-1234",
      verificationUri: "https://example.test/device",
      expiresAt: Date.now() + 90_000,
    });
    expect((await screen.findByTestId("user-code")).textContent).toBe("ABCD-1234");
    const clock = screen.getByTestId("countdown");
    expect(clock.textContent).toMatch(/^1:\d\d$/);
    expect(clock.classList.contains("low")).toBe(false);
    signIn.set({
      kind: "deviceCode",
      userCode: "ABCD-1234",
      verificationUri: "https://example.test/device",
      expiresAt: Date.now() + 30_000,
    });
    await vi.waitFor(() => expect(screen.getByTestId("countdown").classList.contains("low")).toBe(true));
  });

  it.each([
    [{ kind: "denied" }, "Try again"],
    [{ kind: "expired" }, "Get a new code"],
    [{ kind: "failed", reason: "bad" }, "Retry"],
  ] as const)("offers %j recovery", async (state, label) => {
    connectors.set([mk("a", "pullRequests", "deviceCode")]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    signIn.set(state);
    await fireEvent.click(await screen.findByRole("button", { name: label }));
    expect(connectorConnect).toHaveBeenCalledTimes(2);
  });
});

describe("disconnect", () => {
  it("asks before disconnecting", async () => {
    connectors.set([mk("a", "tickets", "browser", { kind: "linked", account: "me" })]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(/watched repositories are kept/i)).toBeTruthy();
    expect(connectorDisconnect).not.toHaveBeenCalled();
    const all = screen.getAllByRole("button", { name: "Disconnect" });
    await fireEvent.click(all[all.length - 1] as HTMLElement);
    await vi.waitFor(() => expect(connectorDisconnect).toHaveBeenCalledWith("a"));
  });
});

describe("watched repositories", () => {
  it("accepts owner/name and rejects anything else", async () => {
    connectors.set([mk("p", "pullRequests", "browser", { kind: "linked", account: "me" })]);
    render(Connectors);
    const input = screen.getByLabelText("Watched repositories", {
      selector: "input",
    }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "nope" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(get(watchedRepos)).toEqual([]);
    await fireEvent.input(input, { target: { value: "acme/web" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(get(watchedRepos)).toEqual(["acme/web"]));
  });
});
