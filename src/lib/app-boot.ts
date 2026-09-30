/**
 * What the shell starts once it is mounted, in the order it has to start.
 */
import { registerAppEvents } from "./app-events";
import { log } from "./logger";
import { startPrPolling } from "./stores/prs";
import { loadSettings } from "./stores/settings";
import { startStatsFeed } from "./stores/stats";
import { activeWorkspacePath, loadWorkspaces, visibleWorkspaces } from "./stores/workspace";
import { get } from "svelte/store";

/** Resolves to the teardown for everything started. */
export async function bootApp(): Promise<() => void> {
  // Settings carry the theme, so they start first and load alongside the
  // workspaces: waiting for them last painted the system theme first on a
  // machine pinned to the other one.
  const settingsLoaded = loadSettings();
  log.info("app", "boot started");
  await loadWorkspaces();
  const ws = get(visibleWorkspaces);
  log.info("app", `workspaces loaded: ${ws.length}`);
  if (ws.length > 0 && !get(activeWorkspacePath)) {
    activeWorkspacePath.set(ws[0].path);
    log.info("app", `active workspace set: ${ws[0].path}`);
  }
  await settingsLoaded;

  // Before anything slow: events fired while a listener is missing are lost.
  const stopEvents = await registerAppEvents();
  // Poll from the shell, not from PrsView: the top-bar badge has to stay
  // current while the Pull requests screen is unmounted.
  const stopPrPolling = startPrPolling();
  // Owned here rather than by the Stats screen: the top bar's spend figure has
  // to stay current while that screen is unmounted. The first scan of a large
  // `~/.claude` can take a while, so nothing waits on it.
  let stopStats: (() => void) | null = null;
  let stopped = false;
  void startStatsFeed().then((stop) => {
    if (stopped) stop();
    else stopStats = stop;
  });

  return () => {
    stopped = true;
    stopEvents();
    stopPrPolling();
    stopStats?.();
  };
}
