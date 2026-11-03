import { get, writable } from "svelte/store";
import type { Ticket } from "../../types/generated/Ticket";
import { connectorGetTicket } from "../ipc";
import { toIpcError } from "../ipc-error";
import { normalizeTicketId } from "../tickets";
import { byKind } from "./connectors";
import { setSessionTicket, type WorkspaceSession, workspaces } from "./workspace";

export type TicketLink = NonNullable<WorkspaceSession["ticket"]>;

export type TicketState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready"; ticket: Ticket }
  | { kind: "notFound" }
  | { kind: "unauthorized" }
  | { kind: "offline" }
  | { kind: "noConnector" }
  | { kind: "error"; message: string };

export interface TicketEntry {
  link: TicketLink | null;
  state: TicketState;
  /** The last successful lookup, kept while a refresh fails. */
  last: Ticket | null;
}

/** Keyed by Atlas session id. */
export const tickets = writable<Record<string, TicketEntry>>({});

const NONE: TicketEntry = { link: null, state: { kind: "none" }, last: null };

function put(sessionId: string, patch: Partial<TicketEntry>) {
  tickets.update((t) => ({ ...t, [sessionId]: { ...(t[sessionId] ?? NONE), ...patch } }));
}

function failure(e: unknown): TicketState {
  const err = toIpcError(e);
  switch (err.kind) {
    case "notFound":
      return { kind: "notFound" };
    case "connectorReconnectNeeded":
      return { kind: "unauthorized" };
    case "connectorNotLinked":
    case "connectorNotConfigured":
      return { kind: "noConnector" };
    case "connectorOffline":
      return { kind: "offline" };
    default:
      return { kind: "error", message: err.message };
  }
}

/** Look `link` up and store the result. Returns whether it succeeded. */
async function lookup(sessionId: string, link: TicketLink): Promise<boolean> {
  put(sessionId, { state: { kind: "loading" } });
  try {
    const ticket = await connectorGetTicket(link.connectorId, link.id);
    put(sessionId, { state: { kind: "ready", ticket }, last: ticket });
    return true;
  } catch (e) {
    put(sessionId, { state: failure(e) });
    return false;
  }
}

/** Validate `rawId`, look it up, and save the link only if that succeeds. */
export async function linkTicket(sessionId: string, rawId: string): Promise<void> {
  const connector = get(byKind).tickets;
  if (!connector) return put(sessionId, { state: { kind: "noConnector" } });
  const id = normalizeTicketId(rawId);
  if (!id) return put(sessionId, { state: { kind: "error", message: "Not a ticket ID" } });
  const link = { connectorId: connector.info.id, id };
  if (await lookup(sessionId, link)) {
    put(sessionId, { link });
    await setSessionTicket(sessionId, link);
  }
}

export async function unlinkTicket(sessionId: string): Promise<void> {
  tickets.update((t) => ({ ...t, [sessionId]: NONE }));
  await setSessionTicket(sessionId, undefined);
}

/** Fetch the saved link again. Call on app launch and session focus while the rail is visible; there is no timer. */
export async function retry(sessionId: string): Promise<void> {
  const link =
    get(tickets)[sessionId]?.link ??
    get(workspaces)
      .flatMap((w) => w.sessions)
      .find((s) => s.id === sessionId)?.ticket ??
    null;
  if (!link) return;
  put(sessionId, { link });
  await lookup(sessionId, link);
}
