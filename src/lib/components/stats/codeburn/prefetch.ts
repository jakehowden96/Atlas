import { filterArgs, type Filters } from "../../../../types/codeburn";
import { codeburn, peekCodeburn } from "../../../stores/codeburn";

/** Each Stats tab's own queries, warmed so opening a tab finds them cached.
 *  Keep in step with the Loader args in the tab components. */
export const tabQueries = (f: Filters): string[][] => [
  ["sessions", "--format", "json", ...filterArgs(f, "sessions"), "--contributions"],
  ["compare", "--format", "json", ...filterArgs(f, "compare")],
  ["models", "--format", "json", ...filterArgs(f, "models"), "--min-cost", "0"],
  ["report", "--format", "json", ...filterArgs(f, "report")],
  ["spend", "--format", "flow-json", ...filterArgs(f, "spend")],
  ["spend", "--format", "branch-json", ...filterArgs(f, "spend")],
  ["sessions", "--by-pr", "--format", "json", ...filterArgs(f, "sessions")],
  ["optimize", "--format", "json", ...filterArgs(f, "optimize")],
  ["yield", "--format", "json", ...filterArgs(f, "yield")],
];

export const whyArgs = (sessionId: string) => ["sessions", "--id", sessionId, "--why", "--format", "json"];

const generations = new Map<string, number>();

/**
 * Load `queries` into the codeburn cache one at a time, skipping any already
 * cached (the background refresh keeps those current). A newer call on the
 * same `channel` stops an older one, so a filter change drops stale work.
 */
export async function prefetch(channel: string, queries: string[][]): Promise<void> {
  const mine = (generations.get(channel) ?? 0) + 1;
  generations.set(channel, mine);
  for (const args of queries) {
    if (generations.get(channel) !== mine) return;
    if (peekCodeburn(args) !== undefined) continue;
    await codeburn(args).catch(() => {});
  }
}
