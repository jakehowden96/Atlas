/**
 * The parts of `codeburn status --format menubar-json` that Atlas reads.
 * Hand-written from real CLI output (codeburn 0.9.27): the CLI has no schema,
 * so a field it drops shows up here as `undefined`, not a type error.
 */
export type Period = "today" | "week" | "30days" | "month" | "all";

export interface Overview {
  generated: string;
  current: {
    label: string;
    cost: number;
    calls: number;
    sessions: number;
    /** "partial" when the session count is a lower bound. */
    sessionCountBasis: string;
    /** 0..1 */
    oneShotRate: number;
    outputTokens: number;
    /** 0..100 */
    cacheHitPercent: number;
    topActivities: { name: string; cost: number; turns: number; oneShotRate: number }[];
    topModels: { name: string; cost: number; calls: number }[];
    topProjects: { id: string; name: string; cost: number; sessions: number }[];
    byBranch: { branch: string; cost: number; sessions: number }[];
    tools: { name: string; calls: number }[];
  };
  history: { daily: { date: string; cost: number }[] };
}
