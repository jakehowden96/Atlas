import { derived, get, writable } from "svelte/store";
import type { ConnectorKind } from "../../types/generated/ConnectorKind";
import type { ConnectorState } from "../../types/generated/ConnectorState";
import {
  connectorCancel,
  connectorConnect,
  connectorDisconnect,
  connectorLinkApiKey,
  connectorList,
  onConnectorDeviceCode,
  onConnectorProgress,
  onConnectorStatus,
} from "../ipc";
import { log } from "../logger";

export type SignInState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waitingBrowser" }
  | { kind: "deviceCode"; userCode: string; verificationUri: string; expiresAt: number }
  | { kind: "exchanging" }
  | { kind: "failed"; reason: string }
  | { kind: "denied" }
  | { kind: "expired" };

export const connectors = writable<ConnectorState[]>([]);
export const signIn = writable<SignInState>({ kind: "idle" });
/** When connectivity was lost, or null while online. */
export const offlineSince = writable<number | null>(null);
export const online = derived(offlineSince, ($s) => $s === null);

const firstLinked = (list: ConnectorState[], kind: ConnectorKind) =>
  list.find((c) => c.info.kind === kind && c.status.kind === "linked") ?? null;

export const byKind = derived(connectors, ($c) => ({
  tickets: firstLinked($c, "tickets"),
  pullRequests: firstLinked($c, "pullRequests"),
}));

export const needsReconnect = derived(connectors, ($c) =>
  $c.filter((c) => c.status.kind === "reconnectNeeded"),
);

/** A fetch reached (or failed to reach) the network. */
export function reportFetch(ok: boolean): void {
  if (ok) offlineSince.set(null);
  else offlineSince.update((s) => s ?? Date.now());
}

const isOffline = (e: unknown) => (e as { kind?: string }).kind === "connectorOffline";

export async function refresh(): Promise<void> {
  try {
    connectors.set(await connectorList());
    reportFetch(true);
  } catch (e) {
    log.warn("connectors", `list failed: ${e}`);
    if (isOffline(e)) reportFetch(false);
  }
}

export async function connect(id: string): Promise<void> {
  signIn.set({ kind: "starting" });
  try {
    await connectorConnect(id);
  } catch (e) {
    signIn.set({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    if (isOffline(e)) reportFetch(false);
    return;
  }
  // Denied, expired and failed end the command with Ok: keep them visible.
  if (["starting", "waitingBrowser", "deviceCode", "exchanging"].includes(get(signIn).kind)) {
    signIn.set({ kind: "idle" });
  }
  await refresh();
}

export async function cancel(id: string): Promise<void> {
  signIn.set({ kind: "idle" });
  try {
    await connectorCancel(id);
  } catch (e) {
    log.warn("connectors", `cancel failed: ${e}`);
  }
}

export async function linkApiKey(id: string, key: string): Promise<void> {
  await connectorLinkApiKey(id, key);
  await refresh();
}

export async function disconnect(id: string): Promise<void> {
  await connectorDisconnect(id);
  await refresh();
}

let starting: Promise<() => void> | null = null;

/** Idempotent: a second call returns the same teardown. */
export function startConnectorEvents(): Promise<() => void> {
  starting ??= (async () => {
    const unlisten = await Promise.all([
      onConnectorStatus(({ connector, status }) =>
        connectors.update((l) => l.map((c) => (c.info.id === connector ? { ...c, status } : c))),
      ),
      onConnectorProgress((p) => {
        switch (p.phase) {
          case "opened":
            signIn.set({ kind: "waitingBrowser" });
            break;
          case "waiting":
            signIn.update((s) =>
              s.kind === "deviceCode"
                ? { ...s, expiresAt: p.expiresAt ?? s.expiresAt }
                : { kind: "waitingBrowser" },
            );
            break;
          case "exchanging":
            signIn.set({ kind: "exchanging" });
            break;
          case "denied":
          case "expired":
            signIn.set({ kind: p.phase });
            break;
          case "failed":
            signIn.set({ kind: "failed", reason: p.message ?? "Sign-in failed" });
            break;
          case "cancelled":
            signIn.set({ kind: "idle" });
            break;
        }
      }),
      onConnectorDeviceCode((d) =>
        signIn.set({
          kind: "deviceCode",
          userCode: d.userCode,
          verificationUri: d.verificationUri,
          expiresAt: Date.now() + d.expiresIn * 1000,
        }),
      ),
    ]);
    const goOffline = () => reportFetch(false);
    const goOnline = () => reportFetch(true);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (!navigator.onLine) goOffline();
    void refresh();
    return () => {
      for (const u of unlisten) u();
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      starting = null;
    };
  })();
  return starting;
}
