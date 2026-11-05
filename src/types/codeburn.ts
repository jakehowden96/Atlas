/**
 * The parts of `codeburn status --format menubar-json` that Atlas reads.
 * Hand-written from real CLI output (codeburn 0.9.27): the CLI has no schema,
 * so a field it drops shows up here as `undefined`, not a type error. Fields
 * added after the first Atlas release are optional for that reason.
 */
export type Period = "today" | "week" | "30days" | "month" | "all";

export interface Timeline {
  bucketMinutes: number;
  modelSeries: { id: string; label: string }[];
  points: {
    timestamp: string;
    cost: number;
    tokens: number;
    models: { seriesId: string; cost: number; tokens: number }[];
  }[];
}

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
    inputTokens?: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    /** 0..100 */
    cacheHitPercent: number;
    topActivities: { name: string; cost: number; turns: number; oneShotRate: number }[];
    topModels: { name: string; cost: number; calls: number; savingsUSD?: number }[];
    topProjects: {
      id: string;
      name: string;
      cost: number;
      sessions: number;
      avgCostPerSession?: number;
    }[];
    byBranch: { branch: string; cost: number; sessions: number }[];
    tools: { name: string; calls: number }[];
    providerDetails?: {
      id: string;
      label: string;
      cost: number;
      calls: number;
      hasUsage: boolean;
    }[];
    modelEfficiency?: { name: string; costPerEdit: number; oneShotRate: number }[];
    workflow?: { corrections: number; correctionRate: number; medianTimeToFirstEditMs: number };
    topReworkedFiles?: { path: string; sessions: number; edits: number }[];
    /** 0..1 */
    pricingCoverage?: number;
    retryTax?: { totalUSD: number; retries: number; editTurns: number };
    routingWaste?: { totalSavingsUSD: number; baselineModel: string };
    localModelSavings?: { totalUSD: number };
    skills?: { name: string; turns: number; cost: number }[];
    subagents?: { name: string; calls: number; cost: number }[];
    mcpServers?: { name: string; calls: number }[];
    topSessions?: {
      project: string;
      cost: number;
      calls: number;
      date: string;
      sessionId: string;
      provider: string;
    }[];
  };
  history: {
    daily: { date: string; cost: number; calls?: number }[];
    timeline?: Timeline;
  };
  /** Consecutive days with usage. */
  streak?: number;
  liveSessions?: {
    sessions: {
      id: string;
      project: string;
      model: string;
      contextTokens: number;
      contextWindow: number;
      idleSeconds: number;
    }[];
  };
}

/** Stats screen filters: one preset period or a custom date range (YYYY-MM-DD). */
export interface Filters {
  period: Period | { from: string; to: string };
  project?: string;
  provider?: string;
}

interface Support {
  period: boolean;
  range: boolean;
  project: boolean;
  provider: boolean;
}

/** What each command accepts (phase 01 map); anything unlisted takes all of it. */
const FILTER_SUPPORT: Record<string, Support> = {
  yield: { period: true, range: false, project: true, provider: true }, // custom range dropped
  "compare-periods": { period: false, range: false, project: true, provider: true }, // caller adds --from-a/--to-a/--from-b/--to-b
  plan: { period: false, range: false, project: false, provider: true },
  quota: { period: false, range: false, project: false, provider: false },
};

/**
 * argv flags for `f`, limited to what `command` supports. Project names with
 * spaces cannot pass the runner's `arg_ok`; codeburn lists projects as
 * dash-joined paths (`E--Projects-app`), so none are expected.
 */
export function filterArgs(f: Filters, command = ""): string[] {
  const s = FILTER_SUPPORT[command] ?? { period: true, range: true, project: true, provider: true };
  const out: string[] = [];
  if (typeof f.period === "string") {
    if (s.period) out.push("--period", f.period);
  } else if (s.range) {
    out.push("--from", f.period.from, "--to", f.period.to);
  }
  if (s.project && f.project) out.push("--project", f.project);
  if (s.provider && f.provider) out.push("--provider", f.provider);
  return out;
}
