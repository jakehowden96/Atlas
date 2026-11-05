/** One row of `codeburn models --format json` (codeburn 0.9.27), fields Atlas reads. */
export interface ModelRow {
  modelDisplayName: string;
  providerDisplayName: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  calls: number;
  costUSD: number;
  isEstimated: boolean;
}
