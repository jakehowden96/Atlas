/** `codeburn sessions --format json` and `--id ID --why`, from codeburn 0.9.27 output. */
export interface Segment {
  day: string;
  category: string;
  branch?: string;
  cost: number;
}

export interface SessionRow {
  sessionId: string;
  title: string;
  /** Mangled directory name, e.g. "E--Projects-fashion-app". */
  project: string;
  provider: string;
  models: string[];
  cost: number;
  calls: number;
  turns: number;
  outputTokens: number;
  /** Subagent count, when codeburn reports it on the row. */
  helperCount?: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** Only with --contributions. */
  contributions?: { segments: Segment[] };
}

export interface WhyTurn {
  i: number;
  prompt?: { text: string };
  cost: number;
  calls: number;
}

export interface WhyFinding {
  id: string;
  kind: string;
  turn?: number;
  /** null when codeburn can't price the finding (e.g. a failed tool call). */
  usd: number | null;
  share: number | null;
  alt?: { model: string; cost: number } | null;
}

export interface SessionWhy {
  sessionId: string;
  title: string;
  /** Real workspace path (unlike SessionRow.project). */
  project: string;
  cost: number;
  calls: number;
  /** Subagent ("helper") spend inside this session. */
  helperCost?: number;
  helperCount?: number;
  turns: WhyTurn[];
  findings?: WhyFinding[];
}
