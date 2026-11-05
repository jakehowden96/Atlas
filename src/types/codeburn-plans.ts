/** Real `codeburn status --format json` / `quota --format json` output (0.9.27). */
export interface BudgetStatus {
  currency: string;
  today: { cost: number; savings: number; calls: number };
  month: { cost: number; savings: number; calls: number };
}

export interface QuotaWindow {
  label: string;
  /** 0..100 */
  usedPct: number;
  /** ISO timestamp */
  resetsAt: string;
}

export interface QuotaProvider {
  id: string;
  name: string;
  available: boolean;
  plan?: string;
  windows: QuotaWindow[];
}

export interface Quota {
  providers: QuotaProvider[];
}
