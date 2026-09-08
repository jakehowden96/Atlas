/**
 * Display formatting shared across views.
 *
 * Both of these were written three times over during the Mission Control
 * refactor — once each in the workspace store, the stats derivations and the
 * PRs view — with ladders that quietly disagreed about how far they counted.
 * They live here so every screen says "2h ago" the same way.
 */

/**
 * Last path segment, for either separator. `split("/")` alone returns the
 * whole string for a Windows path, which then becomes the workspace name.
 */
export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * How long ago `then` was, both instants in epoch milliseconds.
 *
 * `minUnit` decides what the first minute reads as: the stats refresh
 * indicator counts the seconds down ("12s ago"), while the workspace, Resume
 * and PR rows only care that it was "just now".
 *
 * Callers own what an absent or unparseable timestamp means — it is "never"
 * for a workspace that has no session yet, but "just now" for a stats page
 * that has only ever shown a live figure.
 */
export function formatAgo(
  then: number,
  now: number,
  minUnit: "second" | "minute" = "minute",
): string {
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return minUnit === "second" ? `${secs}s ago` : "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}
