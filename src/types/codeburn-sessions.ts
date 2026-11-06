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
  usd: number;
  share: number;
  alt?: { model: string; cost: number };
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
