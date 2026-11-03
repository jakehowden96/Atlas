import { get } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "../../types/generated/Ticket";
import { IpcError } from "../ipc-error";

vi.mock("../ipc", () => ({
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
  connectorGetTicket: vi.fn(),
  connectorList: vi.fn(),
}));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { connectorGetTicket, stateLoad, stateSave } from "../ipc";
import { suggestTicketId } from "../tickets";
import { byKind, connectors } from "../stores/connectors";
import { linkTicket, retry, tickets, unlinkTicket } from "../stores/tickets";
import { loadWorkspaces, WORKSPACE_COLORS, workspaces } from "../stores/workspace";

const SID = "s1";
const ticket: Ticket = {
  id: "ENG-482",
  title: "Fix retry",
  status: "In Progress",
  statusKind: "inProgress",
  url: "https://x/ENG-482",
  assignee: null,
};

const row = (extra: object = {}) => ({
  id: SID,
  label: "S",
  status: "idle",
  terminalTabId: null,
  createdAt: "",
  claudeSessionId: null,
  harnessId: null,
  ...extra,
});
const ws = (sessions: object[]) => ({
  version: 1,
  workspaces: [{ path: "/a", name: "a", color: WORKSPACE_COLORS[0], sessions }],
});

const get_ = vi.mocked(connectorGetTicket);
const entry = () => get(tickets)[SID]!;

describe("ticket link store", () => {
  beforeAll(async () => {
    vi.mocked(stateLoad).mockResolvedValue({ contents: null, recovered: false });
    await loadWorkspaces();
  });

  beforeEach(async () => {
    vi.mocked(stateLoad).mockResolvedValue({
      contents: JSON.stringify(ws([row()])),
      recovered: false,
    });
    await loadWorkspaces();
    tickets.set({});
    get_.mockReset();
    connectors.set([
      {
        info: { id: "linear", name: "Linear", kind: "tickets", flow: "pkce", configured: true },
        status: { kind: "linked" },
      },
    ] as never);
  });

  const savedSession = () => {
    const calls = vi.mocked(stateSave).mock.calls;
    return JSON.parse(calls[calls.length - 1]![1]).workspaces[0].sessions[0];
  };

  it("links on success, normalising the id, and saves the link", async () => {
    get_.mockResolvedValue(ticket);
    await linkTicket(SID, " eng-482 ");
    expect(get_).toHaveBeenCalledWith("linear", "ENG-482");
    expect(entry().state).toEqual({ kind: "ready", ticket });
    expect(entry().link).toEqual({ connectorId: "linear", id: "ENG-482" });
    expect(savedSession().ticket).toEqual({ connectorId: "linear", id: "ENG-482" });
  });

  it("does not save the link when the ticket is not found", async () => {
    get_.mockRejectedValue(new IpcError("notFound", "none"));
    await linkTicket(SID, "ENG-1");
    expect(entry().state).toEqual({ kind: "notFound" });
    expect(entry().link).toBeNull();
    expect(get(workspaces)[0]!.sessions[0]!.ticket).toBeUndefined();
  });

  it("rejects a malformed id without calling the connector", async () => {
    await linkTicket(SID, "nope");
    expect(entry().state.kind).toBe("error");
    expect(get_).not.toHaveBeenCalled();
  });

  it("maps a reconnect-needed failure to unauthorized", async () => {
    get_.mockRejectedValue(new IpcError("connectorReconnectNeeded", "expired"));
    await linkTicket(SID, "ENG-1");
    expect(entry().state).toEqual({ kind: "unauthorized" });
  });

  it("reports noConnector when none is linked", async () => {
    connectors.set([]);
    expect(get(byKind).tickets).toBeNull();
    await linkTicket(SID, "ENG-1");
    expect(entry().state).toEqual({ kind: "noConnector" });
  });

  it("keeps the last good ticket when a refresh goes offline, then recovers", async () => {
    get_.mockResolvedValueOnce(ticket);
    await linkTicket(SID, "ENG-482");
    get_.mockRejectedValueOnce(new IpcError("connectorOffline", "down"));
    await retry(SID);
    expect(entry().state).toEqual({ kind: "offline" });
    expect(entry().last).toEqual(ticket);
    expect(entry().link).not.toBeNull();
    get_.mockResolvedValueOnce(ticket);
    await retry(SID);
    expect(entry().state.kind).toBe("ready");
  });

  it("maps other failures to error with the message", async () => {
    get_.mockRejectedValue(new IpcError("connectorRemote", "boom"));
    await linkTicket(SID, "ENG-1");
    expect(entry().state).toEqual({ kind: "error", message: "boom" });
  });

  it("unlinks and clears the saved link", async () => {
    get_.mockResolvedValue(ticket);
    await linkTicket(SID, "ENG-482");
    await unlinkTicket(SID);
    expect(entry().state).toEqual({ kind: "none" });
    expect(entry().link).toBeNull();
    expect(savedSession().ticket).toBeUndefined();
  });

  it("survives a reload and retry reads the saved link", async () => {
    get_.mockResolvedValue(ticket);
    await linkTicket(SID, "ENG-482");
    const calls = vi.mocked(stateSave).mock.calls;
    const saved = calls[calls.length - 1]![1];
    vi.mocked(stateLoad).mockResolvedValue({ contents: saved, recovered: false });
    await loadWorkspaces();
    tickets.set({});
    expect(get(workspaces)[0]!.sessions[0]!.ticket).toEqual({
      connectorId: "linear",
      id: "ENG-482",
    });
    await retry(SID);
    expect(entry().state.kind).toBe("ready");
  });

  it("loads rows written before ticket links existed", () => {
    expect(get(workspaces)[0]!.sessions[0]!.ticket).toBeUndefined();
  });
});

describe("suggestTicketId", () => {
  it.each([
    ["jake/eng-482-fix-retry", "ENG-482"],
    ["feature/ENG-482", "ENG-482"],
    ["ENG-1", "ENG-1"],
    ["abc-12-and-xyz-99", "ABC-12"],
    ["main", null],
    ["fix-retry-logic", null],
    ["eng-", null],
    ["1ENG-1", null],
  ])("%s -> %s", (branch, want) => {
    expect(suggestTicketId(branch)).toBe(want);
  });
});
