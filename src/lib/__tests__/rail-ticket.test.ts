// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type { ConnectorState } from "../../types/generated/ConnectorState";
import type { Ticket } from "../../types/generated/Ticket";

vi.mock("../ipc", () => ({
  stateLoad: vi.fn(async () => ({ contents: null, recovered: false })),
  stateSave: vi.fn(async () => undefined),
  connectorGetTicket: vi.fn(),
  connectorList: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { connectorGetTicket } from "../ipc";
import { IpcError } from "../ipc-error";
import RailTicket from "../components/session/rail/RailTicket.svelte";
import { connectors } from "../stores/connectors";
import { settingsOpen } from "../stores/settings";
import { tickets } from "../stores/tickets";
import { get } from "svelte/store";

const SID = "s1";
const ticket: Ticket = {
  id: "ENG-482",
  title: "Fix retry",
  status: "In Progress",
  statusKind: "inProgress",
  url: "https://x/ENG-482",
  assignee: null,
};
const conn = (status: ConnectorState["status"]): ConnectorState => ({
  info: { id: "linear", name: "Linear", kind: "tickets", flow: "pkce", configured: true } as never,
  status,
});
const linked = { kind: "linked", account: "a" } as const;
const props = { sessionId: SID, branch: "eng-482-fix", branchLine: "" };
const entry = (state: object, extra: object = {}) =>
  tickets.set({
    [SID]: {
      link: { connectorId: "linear", id: "ENG-482" },
      state: state as never,
      last: null,
      ...extra,
    },
  });

beforeEach(() => {
  connectors.set([conn(linked)]);
  tickets.set({});
});
afterEach(() => {
  cleanup();
  settingsOpen.set(false);
  vi.mocked(connectorGetTicket).mockReset();
});

describe("RailTicket", () => {
  it("shows the empty state with a link button", () => {
    render(RailTicket, props);
    expect(screen.getByText("No ticket linked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link ticket" })).toBeTruthy();
  });

  it("shows a linked ticket with a text status chip and a menu", () => {
    entry({ kind: "ready", ticket }, { last: ticket });
    render(RailTicket, props);
    expect(screen.getByText("ENG-482")).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("Fix retry")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ticket actions" })).toBeTruthy();
  });

  it("names the provider from the connector when none is linked", async () => {
    connectors.set([conn({ kind: "notLinked" })]);
    render(RailTicket, props);
    expect(screen.getByText("Link Linear to show tickets")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Link →" }));
    expect(get(settingsOpen)).toBe(true);
  });

  it("dims a stale ticket and retries", async () => {
    entry({ kind: "offline" }, { last: ticket });
    vi.mocked(connectorGetTicket).mockResolvedValue(ticket);
    render(RailTicket, props);
    expect(screen.getByText(/couldn't refresh/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(connectorGetTicket).toHaveBeenCalledWith("linear", "ENG-482"));
  });

  it("opens the editor, suggests from the branch, and Tab accepts it", async () => {
    render(RailTicket, props);
    await fireEvent.click(screen.getByRole("button", { name: "Link ticket" }));
    const input = screen.getByRole("textbox", { name: "Ticket ID" }) as HTMLInputElement;
    expect(screen.getByRole("button", { name: /ENG-482/ })).toBeTruthy();
    await fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("ENG-482");
  });

  it("rejects an invalid id before any request", async () => {
    render(RailTicket, { ...props, branch: "" });
    await fireEvent.click(screen.getByRole("button", { name: "Link ticket" }));
    const input = screen.getByRole("textbox", { name: "Ticket ID" });
    await fireEvent.input(input, { target: { value: "nope" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Use a ticket ID like ABC-123")).toBeTruthy();
    expect(connectorGetTicket).not.toHaveBeenCalled();
  });

  it("links on Enter and closes", async () => {
    vi.mocked(connectorGetTicket).mockResolvedValue(ticket);
    render(RailTicket, props);
    await fireEvent.click(screen.getByRole("button", { name: "Link ticket" }));
    const input = screen.getByRole("textbox", { name: "Ticket ID" });
    await fireEvent.input(input, { target: { value: "eng-482" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(screen.getByText("Fix retry")).toBeTruthy();
  });

  it.each([
    ["notFound", "NOT_FOUND", /No ticket ENG-999 found/],
    ["connectorReconnectNeeded", "x", /sign in again/],
    ["connectorOffline", "x", /offline/],
  ])("shows the %s failure in the editor", async (kind, message, text) => {
    vi.mocked(connectorGetTicket).mockRejectedValue(new IpcError(kind as never, message));
    render(RailTicket, props);
    await fireEvent.click(screen.getByRole("button", { name: "Link ticket" }));
    const input = screen.getByRole("textbox", { name: "Ticket ID" });
    await fireEvent.input(input, { target: { value: "ENG-999" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  });

  it("Esc cancels and returns focus to the trigger", async () => {
    render(RailTicket, props);
    await fireEvent.click(screen.getByRole("button", { name: "Link ticket" }));
    await fireEvent.keyDown(screen.getByRole("textbox", { name: "Ticket ID" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Link ticket" }));
  });
});
