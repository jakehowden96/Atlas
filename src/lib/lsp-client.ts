/**
 * The bridge between `@codemirror/lsp-client` and the Rust process host.
 *
 * `Transport` is deliberately tiny — send a string, subscribe to strings — so
 * everything protocol-shaped stays in the CodeMirror client and everything
 * process-shaped stays in `src-tauri/src/lsp`. This file is only the wire.
 */
import { LSPClient } from "@codemirror/lsp-client";
import { lspSend, lspStart, onLspMessage } from "./ipc";
import { log } from "./logger";

export interface Transport {
  send(message: string): void;
  subscribe(handler: (value: string) => void): void;
  unsubscribe(handler: (value: string) => void): void;
}

/** Handlers per session id. One backend listener fans out to all of them. */
const handlers = new Map<string, Set<(value: string) => void>>();
/** In-flight or settled starts, keyed the same way the backend keys sessions. */
const starting = new Map<string, Promise<string | null>>();
const clients = new Map<string, LSPClient>();
let listening: Promise<unknown> | null = null;

/** Attach the single `lsp-message` listener, once per app run. */
function ensureListening() {
  if (listening) return;
  listening = onLspMessage((id, message) => {
    for (const handler of handlers.get(id) ?? []) handler(message);
  }).catch((e) => {
    log.error("lsp", "could not listen for language server messages", e);
    listening = null;
  });
}

function sessionKey(languageId: string, root: string): string {
  return `${languageId}:${root}`;
}

/**
 * A transport for `languageId` in `root`, or null when that language has no
 * server installed. Null is the ordinary case for most file types and is not
 * an error: the editor still highlights and edits, it just has no diagnostics.
 */
export async function transportFor(
  languageId: string,
  root: string,
): Promise<Transport | null> {
  ensureListening();
  const key = sessionKey(languageId, root);
  let pending = starting.get(key);
  if (!pending) {
    pending = lspStart(languageId, root).catch((e) => {
      log.info("lsp", `no language server for ${languageId}: ${e}`);
      return null;
    });
    starting.set(key, pending);
  }
  const id = await pending;
  if (!id) return null;

  return {
    send(message: string) {
      lspSend(id, message).catch((e) =>
        log.warn("lsp", `send to ${id} failed: ${e}`),
      );
    },
    subscribe(handler) {
      const set = handlers.get(id) ?? new Set();
      set.add(handler);
      handlers.set(id, set);
    },
    unsubscribe(handler) {
      handlers.get(id)?.delete(handler);
    },
  };
}

/**
 * The connected client for a language and workspace, or null when there is no
 * server. One client per pair, shared by every editor on that pair — the
 * expensive part of a language server is the indexing it does at startup.
 */
export async function clientFor(
  languageId: string,
  root: string,
): Promise<LSPClient | null> {
  const key = sessionKey(languageId, root);
  const existing = clients.get(key);
  if (existing) return existing;
  const transport = await transportFor(languageId, root);
  if (!transport) return null;
  const client = new LSPClient({ rootUri: `file://${root}` }).connect(transport);
  clients.set(key, client);
  return client;
}

/** Test seam: drop every cached client, handler and start. */
export function resetLspClients() {
  handlers.clear();
  starting.clear();
  clients.clear();
  listening = null;
}
