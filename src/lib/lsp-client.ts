/**
 * The bridge between `@codemirror/lsp-client` and the Rust process host.
 *
 * `Transport` is deliberately tiny — send a string, subscribe to strings — so
 * everything protocol-shaped stays in the CodeMirror client and everything
 * process-shaped stays in `src-tauri/src/lsp`. This file is only the wire.
 */
import { LSPClient } from "@codemirror/lsp-client";
import { writable } from "svelte/store";
import { pathToFileUri } from "./files";
import { lspSend, lspStart, lspStop, onLspExit, onLspMessage } from "./ipc";
import { log } from "./logger";

export interface Transport {
  send(message: string): void;
  subscribe(handler: (value: string) => void): void;
  unsubscribe(handler: (value: string) => void): void;
}

/** Handlers per session id. One backend listener fans out to all of them. */
const handlers = new Map<string, Set<(value: string) => void>>();
/** In-flight or settled starts, keyed the same way the backend keys sessions.
 *  A failed start is removed, so installing a server does not need a restart. */
const starting = new Map<string, Promise<string | null>>();
/** One client per pair. The promise is stored, not the result, so two editors
 *  mounting together share a client instead of each creating one. */
const clients = new Map<string, Promise<LSPClient | null>>();
let listening: Promise<unknown> | null = null;

/** Workspace roots the backend refused because language servers are off there.
 *  The editor offers to turn them on; a root leaves the set as soon as a start
 *  for it succeeds. */
export const untrustedRoots = writable<Set<string>>(new Set());

function markUntrusted(root: string, untrusted: boolean) {
  untrustedRoots.update((current) => {
    if (current.has(root) === untrusted) return current;
    const next = new Set(current);
    if (untrusted) next.add(root);
    else next.delete(root);
    return next;
  });
}

/** Forget everything held for one session: its start, its message handlers and
 *  its client, which is disconnected. */
function evict(key: string) {
  starting.delete(key);
  handlers.delete(key);
  const client = clients.get(key);
  clients.delete(key);
  void client?.then((c) => c?.disconnect());
}

/** Attach the `lsp-message` and `lsp-exit` listeners, once per app run. A
 *  server that exits on its own is evicted, so the next editor to need one
 *  starts a fresh server instead of talking to a dead id forever. */
function ensureListening() {
  if (listening) return;
  listening = Promise.all([
    onLspMessage((id, message) => {
      for (const handler of handlers.get(id) ?? []) handler(message);
    }),
    onLspExit((id) => {
      log.warn("lsp", `language server ${id} exited`);
      evict(id);
    }),
  ]).catch((e) => {
    log.error("lsp", "could not listen for language server events", e);
    listening = null;
  });
}

function sessionKey(languageId: string, root: string): string {
  return `${languageId}:${root}`;
}

/**
 * A transport for `languageId` in `root`, or null when there is no server to
 * talk to: none installed for that language (the ordinary case for most file
 * types), or language servers are off for the workspace, which also puts
 * `root` in `untrustedRoots`. Neither is an error: the editor still highlights
 * and edits, it just has no diagnostics.
 */
export async function transportFor(languageId: string, root: string): Promise<Transport | null> {
  ensureListening();
  const key = sessionKey(languageId, root);
  let pending = starting.get(key);
  if (!pending) {
    pending = lspStart(languageId, root)
      .then((result) => {
        if (result.kind === "started") {
          markUntrusted(root, false);
          return result.id;
        }
        // Neither outcome is remembered: installing a server, or turning them
        // on, takes effect the next time an editor asks.
        log.info(
          "lsp",
          result.kind === "notTrusted"
            ? `language servers are off for ${root}`
            : `no language server for ${languageId}`,
        );
        if (result.kind === "notTrusted") markUntrusted(root, true);
        starting.delete(key);
        return null;
      })
      .catch((e) => {
        log.info("lsp", `no language server for ${languageId}: ${e}`);
        starting.delete(key);
        return null;
      });
    starting.set(key, pending);
  }
  const id = await pending;
  if (!id) return null;

  return {
    send(message: string) {
      lspSend(id, message).catch((e) => log.warn("lsp", `send to ${id} failed: ${e}`));
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
export function clientFor(languageId: string, root: string): Promise<LSPClient | null> {
  const key = sessionKey(languageId, root);
  const existing = clients.get(key);
  if (existing) return existing;
  const created = transportFor(languageId, root).then((transport) => {
    if (!transport) {
      clients.delete(key);
      return null;
    }
    return new LSPClient({ rootUri: pathToFileUri(root) }).connect(transport);
  });
  created.catch(() => clients.delete(key));
  clients.set(key, created);
  return created;
}

/**
 * Stop every language server running for a workspace and forget its clients.
 * Called when the user turns language servers off there, so nothing keeps
 * running project code after trust is withdrawn.
 */
export async function stopServersFor(root: string): Promise<void> {
  const keys = [...starting.keys()].filter((key) => key.slice(key.indexOf(":") + 1) === root);
  for (const key of keys) {
    const id = await starting.get(key);
    evict(key);
    if (!id) continue;
    try {
      await lspStop(id);
    } catch (e) {
      log.warn("lsp", `could not stop ${id}: ${e}`);
    }
  }
}

/** Test seam: drop every cached client, handler and start. */
export function resetLspClients() {
  handlers.clear();
  starting.clear();
  clients.clear();
  untrustedRoots.set(new Set());
  listening = null;
}
