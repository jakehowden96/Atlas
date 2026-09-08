export interface ModelStats {
  sessions: number;
  assistantMsgs: number;
  userMessages: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cost: number;
  toolCalls: number;
  toolErrors: number;
  totalDurationSecs: number;
  totalSubagents: number;
  peakContextMax: number;
  userChars: number;
  // Derived averages
  msgsPerSession: number;
  toolsPerSession: number;
  errorRate: number;
  costPerSession: number;
  outputPerSession: number;
  avgDurationSecs: number;
  avgMessageChars: number;
  subagentsPerSession: number;
  avgOutputPerMsg: number;
  costPerKOutput: number;
  subagentPromptChars: number;
  subagentPromptCount: number;
  avgSubagentPromptChars: number;
}

export interface ProjectStats {
  sessions: number;
  outputTokens: number;
  userMessages: number;
  cost: number;
  subagents: number;
}

export interface DayStats {
  sessions: number;
  outputTokens: number;
  userMessages: number;
  cost: number;
  /** Largest single-session peak that day, not a sum. */
  peakContext: number;
  subagents: number;
}

export interface WeekStats {
  sessions: number;
  byModel: Record<string, number>;
  byModelSubagents: Record<string, number>;
}

/**
 * A session as the Recent-sessions table needs it. A deliberately trimmed
 * projection of the backend's `SessionRecord` — the absolute transcript path
 * never crosses IPC.
 */
export interface RecentSession {
  sessionId: string;
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  lastTimestamp: string | null;
  durationSecs: number;
  outputTokens: number;
  costEstimate: number;
}

/**
 * A prior conversation the New Session modal can hand to `claude --resume`.
 * Mirrors `ResumableSession` in `src-tauri/src/commands/stats.rs`.
 */
export interface ResumableSession {
  /** The transcript uuid — exactly what `--resume` takes. */
  sessionId: string;
  title: string | null;
  gitBranch: string | null;
  lastTimestamp: string | null;
  userMessages: number;
}

/** Headline numbers for one time window — one KPI strip's worth. */
export interface RangeTotals {
  sessions: number;
  userMessages: number;
  outputTokens: number;
  cost: number;
  /** Largest single-session peak in the window, not a sum. */
  peakContext: number;
  subagents: number;
}

export interface StatsSummary {
  totalSessions: number;
  totalUserMessages: number;
  totalAssistantMessages: number;
  peakContextOverall: number;
  avgPeakContext: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCostEstimate: number;
  totalToolErrors: number;
  totalSubagents: number;
  errorRate: number;
  byModel: Record<string, ModelStats>;
  byModel30d: Record<string, ModelStats>;
  byModel7d: Record<string, ModelStats>;
  byModelSubagents: Record<string, ModelStats>;
  byModelSubagents30d: Record<string, ModelStats>;
  byModelSubagents7d: Record<string, ModelStats>;
  toolUsage: Record<string, number>;
  toolErrors: Record<string, number>;
  toolUsage30d: Record<string, number>;
  toolErrors30d: Record<string, number>;
  toolUsage7d: Record<string, number>;
  toolErrors7d: Record<string, number>;
  byProject: Record<string, ProjectStats>;
  byProject30d: Record<string, ProjectStats>;
  byProject7d: Record<string, ProjectStats>;
  byDay: Record<string, DayStats>;
  byWeek: Record<string, WeekStats>;
  /** The 50 newest sessions, newest first. */
  recentSessions: RecentSession[];
  totalsAll: RangeTotals;
  totals30d: RangeTotals;
  totalsPrev30d: RangeTotals;
  totals7d: RangeTotals;
  totalsPrev7d: RangeTotals;
  versions: string[];
  generatedAt: string;
}
