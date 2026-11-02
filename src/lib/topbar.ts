export type TopBarTier = "full" | "mid" | "compact";

export interface StatusCounts {
  running: number;
  needsYou: number;
  idle: number;
  spend: number;
}

export interface StatusPart {
  kind: "running" | "needsYou" | "idle" | "spend";
  text: string;
}

/** Top-bar width tiers: all counts at 1400+, running and needs-you at 1100, a chip below. */
export function topBarTier(width: number): TopBarTier {
  if (width >= 1400) return "full";
  if (width >= 1100) return "mid";
  return "compact";
}

/** The status-line parts shown at a tier. The compact chip shows the same two as "mid". */
export function statusParts(tier: TopBarTier, c: StatusCounts): StatusPart[] {
  const parts: StatusPart[] = [
    { kind: "running", text: `${c.running} running` },
    { kind: "needsYou", text: `${c.needsYou} needs you` },
  ];
  if (tier === "full") {
    parts.push({ kind: "idle", text: `${c.idle} idle` });
    parts.push({ kind: "spend", text: `$${c.spend.toFixed(2)} today` });
  }
  return parts;
}
