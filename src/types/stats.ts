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
}

export interface ProjectStats {
  sessions: number;
  outputTokens: number;
  userMessages: number;
}

export interface DayStats {
  sessions: number;
  outputTokens: number;
  userMessages: number;
}

export interface WeekStats {
  sessions: number;
  byModel: Record<string, number>;
  byModelSubagents: Record<string, number>;
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
  byProject: Record<string, ProjectStats>;
  byDay: Record<string, DayStats>;
  byWeek: Record<string, WeekStats>;
  versions: string[];
  generatedAt: string;
}
