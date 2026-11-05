/**
 * The parts of `codeburn optimize --format json` that Atlas reads.
 * Hand-written from real CLI output (codeburn 0.9.27).
 */
export type FindingClass = "fix" | "nudge" | "keep";

export interface Finding {
  id: string;
  title: string;
  explanation: string;
  severity: "high" | "medium" | "low";
  trend: string | null;
  tokensSaved: number;
  estimatedSavingsUSD: number;
  class: FindingClass;
  /** "measured" or "estimated" */
  basis: string;
  fix?: { type: string; destination?: string; label: string; text: string };
}

export interface OptimizeReport {
  summary: {
    healthScore: number;
    healthGrade: string;
    findingCount: number;
    periodCostUSD: number;
    potentialSavingsCostUSD: number;
    potentialSavingsPercent: number;
  };
  findings: Finding[];
}
