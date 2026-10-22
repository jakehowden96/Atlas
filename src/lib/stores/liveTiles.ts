import { derived } from "svelte/store";
import { buildTiles } from "../overview";
import { liveSessionList } from "./liveSessions";
import { tabs } from "./terminal";
import { sessionDiffStats, visibleWorkspaces } from "./workspace";

/**
 * The terminal tabs the Notification hook has flagged. Derived apart from
 * `tabs` so a change that leaves the flags alone — a PTY id landing, `ready`
 * flipping — does not re-run the tile join below.
 */
let current: ReadonlySet<string> = new Set();
const needsInputTabs = derived(
  tabs,
  ($tabs, set) => {
    const next = new Set($tabs.filter((t) => t.needsInput).map((t) => t.id));
    if (next.size === current.size && [...next].every((id) => current.has(id))) return;
    current = next;
    set(next);
  },
  new Set<string>(),
);

/**
 * Every session tile, joined once for the whole app. The top bar, the Sessions
 * grid, the Session header and the jump palette all read this instead of each
 * running `buildTiles` (and its per-session reply parsing) on every session
 * update. Callers that need an order sort a copy.
 */
export const liveTiles = derived(
  [liveSessionList, visibleWorkspaces, sessionDiffStats, needsInputTabs],
  ([$live, $workspaces, $diffStats, $needsInput]) =>
    buildTiles($live, $workspaces, $diffStats, $needsInput),
);
