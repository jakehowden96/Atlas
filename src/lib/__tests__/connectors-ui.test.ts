// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";

vi.mock("../ipc", () => ({
  connectorList: vi.fn(async () => []),
  connectorLinkCli: vi.fn(async () => {}),
  connectorLinkApiKey: vi.fn(async () => {}),
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

import { connectorConnect, connectorDisconnect, connectorLinkCli } from "../ipc";
import Connectors from "../components/settings/sections/Connectors.svelte";
import { connect, connectors, signIn } from "../stores/connectors";
import type { AuthMethod } from "../../types/generated/AuthMethod";
import type { ConnectorState } from "../../types/generated/ConnectorState";

const mk = (
  id: string,
  kind: "tickets" | "pullRequests",
  flow: "browser" | "deviceCode",
  status: ConnectorState["status"] = { kind: "notLinked" },
  configured = true,
  methods: AuthMethod[] = ["oauth"],
  method: AuthMethod | null = status.kind === "notLinked" ? null : "oauth",
): ConnectorState => ({
  info: { id, name: `Name ${id}`, kind, flow, methods, configured },
  status,
  method,
});

beforeEach(() => {
  vi.clearAllMocks();
  signIn.set({ kind: "idle" });
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
      mk("e", "tickets", "browser", { kind: "notLinked" }, false),
    ]);
    render(Connectors);
    expect(screen.getByText("Linked as me")).toBeTruthy();
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    expect(screen.getByText("expired")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByText("Not configured in this build")).toBeTruthy();
    const connect = screen.getAllByRole("button", { name: "Connect" }) as HTMLButtonElement[];
    expect(connect.map((b) => b.disabled)).toEqual([false, true]);
  });
});

describe("sign-in methods", () => {
  const both: AuthMethod[] = ["oauth", "cli"];

  it("offers a picker only when there is a choice", () => {
    connectors.set([mk("a", "tickets", "browser")]);
    render(Connectors);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("links through the CLI as soon as it is picked, and names it once linked", async () => {
    connectors.set([mk("g", "pullRequests", "deviceCode", undefined, true, both)]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("radio", { name: "Name g CLI" }));
    expect(connectorLinkCli).toHaveBeenCalledWith("g");
    expect(connectorConnect).not.toHaveBeenCalled();

    cleanup();
    connectors.set([
      mk("g", "pullRequests", "deviceCode", { kind: "linked", account: "me" }, true, both, "cli"),
    ]);
    render(Connectors);
    expect(screen.getByText("Linked as me · Name g CLI")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use|Reconnect/ })).toBeNull();
  });

  it("starts the app sign-in when it is picked over a CLI link", async () => {
    connectors.set([
      mk("g", "pullRequests", "deviceCode", { kind: "linked", account: "me" }, true, both, "cli"),
    ]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("radio", { name: "Sign in with Name g" }));
    expect(connectorConnect).toHaveBeenCalledWith("g");
  });

  it("shows the CLI's reason when it cannot link", async () => {
    vi.mocked(connectorLinkCli).mockRejectedValueOnce(new Error("Run gh auth login"));
    connectors.set([mk("g", "pullRequests", "deviceCode", undefined, true, both)]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("radio", { name: "Name g CLI" }));
    expect(await screen.findByText("Run gh auth login")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("asks for a key only when API key is picked", async () => {
    connectors.set([mk("l", "tickets", "browser", undefined, true, ["oauth", "apiKey"])]);
    render(Connectors);
    expect(screen.queryByLabelText("Name l API key")).toBeNull();
    await fireEvent.click(screen.getByRole("radio", { name: "API key" }));
    expect(screen.getByLabelText("Name l API key")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
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

  it("shows the dialog for a sign-in started elsewhere (a status chip's reconnect)", async () => {
    connectors.set([mk("a", "tickets", "browser")]);
    render(Connectors);
    void connect("a");
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
    await vi.waitFor(() =>
      expect(screen.getByTestId("countdown").classList.contains("low")).toBe(true),
    );
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
    connectors.set([mk("a", "pullRequests", "browser", { kind: "linked", account: "me" })]);
    render(Connectors);
    await fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(/watched repositories are kept/i)).toBeTruthy();
    expect(connectorDisconnect).not.toHaveBeenCalled();
    const all = screen.getAllByRole("button", { name: "Disconnect" });
    await fireEvent.click(all[all.length - 1] as HTMLElement);
    await vi.waitFor(() => expect(connectorDisconnect).toHaveBeenCalledWith("a"));
  });
});
