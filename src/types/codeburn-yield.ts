/** `codeburn yield --format json` (0.9.27). Only the fields Atlas reads. */
export type YieldCategory = "productive" | "reverted" | "abandoned" | "ambiguous";

export interface YieldBucket {
  costUSD: number;
  sessions: number;
  /** 0..100 */
  costPercent: number;
  sessionPercent: number;
}

export interface Yield {
  period: { label: string };
  summary: Record<YieldCategory, YieldBucket> & { total: { costUSD: number; sessions: number } };
  details: {
    sessionId: string;
    project: string;
    costUSD: number;
    category: YieldCategory;
    commitCount: number;
  }[];
}
