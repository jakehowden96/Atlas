/**
 * Owns one mounted `TerminalTab` per tab id, in a host div nothing else
 * tracks.
 *
 * `TerminalContainer`'s `{#each $tabs as tab (tab.id)}` used to own every
 * tab's DOM node, and `$tabs` gets a new array reference on almost every
 * tab-level change (title, ready, needsInput…) — so if a node were just
 * `appendChild`'d somewhere else, Svelte's keyed reconciliation would yank it
 * back on the next re-run. Mounting each tab once with Svelte 5's imperative
 * `mount()`/`unmount()`, into a host `<div>` no `{#each}` ever manages, means
 * nothing fights over where that div lives — the Session pane, a tile's slot,
 * or the parking root below can all move it with a plain `appendChild`.
 *
 * A remount is not an option either way: `TerminalTab`'s `onDestroy` kills the
 * PTY, so mounting a tab a second time would spawn a second Claude Code
 * process.
 */
import { mount, unmount } from "svelte";
import TerminalTab from "./components/terminal/TerminalTab.svelte";

interface TerminalProps {
  tabId: string;
  visible: boolean;
  ready: boolean;
  cwd?: string;
  onData?: (data: string) => void;
  onPtyReady: (ptyId: number) => void;
}

interface Entry {
  host: HTMLDivElement;
  props: TerminalProps;
  instance: Record<string, unknown>;
}

const entries = new Map<string, Entry>();
/** Tile slots currently registered, keyed by tab id. */
const tileSlots = new Map<string, HTMLElement>();
let paneSlot: HTMLElement | null = null;

/**
 * Off-screen but sized, not `display:none`. A tab is constructed the moment
 * it enters `$tabs`, and `TerminalSession.spawnWhenSized` spawns synchronously
 * once its container has a real box — a 0x0 parking root would send every
 * background session down the 1s fallback path and spawn it at xterm's
 * default 80x24 instead of the pane's real geometry.
 */
const parkingRoot = document.createElement("div");
parkingRoot.style.position = "fixed";
parkingRoot.style.left = "-99999px";
parkingRoot.style.top = "0";
parkingRoot.style.overflow = "hidden";
document.body.appendChild(parkingRoot);

/** The host always fills whatever it is currently appended into — the
 *  Session pane, a tile's slot, or the fixed-size parking root — so a
 *  session refits (and resizes its PTY, via `TerminalSession`'s own resize
 *  observer) to the real box it is showing in rather than to one fixed
 *  geometry cropped into place. */
function sizeHost(host: HTMLDivElement) {
  host.style.width = "100%";
  host.style.height = "100%";
}

/** `position: relative`, never `static` — that is what `TerminalTab`'s
 *  `position: absolute; inset: 0` loading overlay needs to anchor to,
 *  rather than to some ancestor further up. */
function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.position = "relative";
  host.style.overflow = "hidden";
  return host;
}

/** Mounts on first call and returns the new host; returns the existing host
 *  on every later call, updating its reactive props in place. */
export function ensureTerminalTab(tabId: string, props: TerminalProps): HTMLDivElement {
  const existing = entries.get(tabId);
  if (existing) {
    Object.assign(existing.props, props);
    return existing.host;
  }

  const host = createHost();
  sizeHost(host);
  parkingRoot.appendChild(host);

  const reactiveProps = $state({ ...props });
  const instance = mount(TerminalTab, { target: host, props: reactiveProps });
  entries.set(tabId, { host, props: reactiveProps, instance });
  return host;
}

/** Unmount (runs `TerminalTab`'s existing `onDestroy` → `session.destroy()`,
 *  unchanged) and drop every trace of the tab from the registry. */
export function destroyTerminalTab(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  void unmount(entry.instance);
  entry.host.remove();
  entries.delete(tabId);
  tileSlots.delete(tabId);
}

/** Session view's terminal pane registers the element its visible tab's host
 *  should be moved into. Pass `null` on unmount/teardown. */
export function setPaneSlot(el: HTMLElement | null): void {
  paneSlot = el;
}

/** A tile registers the element it wants its tab's host moved into whenever
 *  it, rather than the Session pane, should be showing that tab. Pass `null`
 *  when the tile unmounts or stops matching a tab. */
export function setTileSlot(tabId: string, el: HTMLElement | null): void {
  if (el) tileSlots.set(tabId, el);
  else tileSlots.delete(tabId);
}

/** The Session pane's current box, used only to size the parking root — a
 *  backgrounded host fills that at 100%, same as any other target. Ignores
 *  0x0: a hidden pane measures nothing, and the parking root should keep its
 *  last real geometry rather than collapse every backgrounded host to zero
 *  size. */
export function setPaneSize(size: { w: number; h: number }): void {
  if (size.w <= 0 || size.h <= 0) return;
  parkingRoot.style.width = `${size.w}px`;
  parkingRoot.style.height = `${size.h}px`;
}

/**
 * The single placement pass. Every host's parent is exactly one of: the
 * Session pane (its tab is the one Session view is showing), a tile's slot,
 * or the parking root. Called from one `$effect` in `TerminalContainer` —
 * never from the pane or a tile directly, which only ever register where they
 * want a host, so nothing here ever fights over a node's position.
 */
export function placeTerminals(tabIds: string[], showingPane: boolean, visibleTabId: string): void {
  for (const tabId of tabIds) {
    const entry = entries.get(tabId);
    if (!entry) continue;
    const tileSlot = tileSlots.get(tabId);
    const target = showingPane && tabId === visibleTabId ? paneSlot : tileSlot ?? parkingRoot;
    if (!target) continue;
    if (entry.host.parentElement !== target) {
      target.appendChild(entry.host);
    }
  }
}
