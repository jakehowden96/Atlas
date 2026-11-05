import type { Finding, FindingClass } from "../../../../types/codeburn-optimize";

export const GROUPS: { cls: FindingClass; title: string }[] = [
  { cls: "fix", title: "Fix now" },
  { cls: "nudge", title: "Habits" },
  { cls: "keep", title: "FYI" },
];

/** Findings per group, biggest saving first; empty groups are dropped. */
export function groupFindings(findings: Finding[]) {
  return GROUPS.map((g) => ({
    ...g,
    items: findings
      .filter((f) => f.class === g.cls)
      .sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD),
  })).filter((g) => g.items.length > 0);
}
