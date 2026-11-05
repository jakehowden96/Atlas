/** `codeburn sessions --by-pr --format json` (0.9.27). Only the fields Atlas reads. */
export interface PrRow {
  url: string;
  label: string;
  cost: number;
  sessions: number;
  /** "merged" when merged, otherwise null (open/unknown). */
  state: string | null;
}

export interface PullRequests {
  prs: PrRow[];
  distinct: { cost: number; sessions: number; attributedCost: number; unattributedCost: number };
}
