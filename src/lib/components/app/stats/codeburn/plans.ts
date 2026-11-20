/** Presets `codeburn plan set` accepts (0.9.27). */
export const PLAN_PRESETS = [
  "claude-pro",
  "claude-max",
  "claude-max-5x",
  "cursor-pro",
  "supergrok",
  "supergrok-heavy",
  "copilot-pro",
  "copilot-pro-plus",
  "copilot-max",
  "google-ai-pro",
  "google-ai-ultra-5x",
  "google-ai-ultra-20x",
  "none",
] as const;

/** "2d 4h", "3h 20m", "12m"; "now" once the reset time has passed or is unparseable. */
export function resetCountdown(resetsAt: string, now: number): string {
  const ms = Date.parse(resetsAt) - now;
  if (!(ms > 0)) return "now";
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
