const ID = /[A-Za-z]+-\d+/;

/** First `ABC-123` in `branch` (case-insensitive), upper-cased. Mirrors the Rust `ticket_id_from_branch`. */
export function suggestTicketId(branch: string): string | null {
  // The key must begin at a word boundary so `xENG-1` is not a hit on `ENG-1`.
  const m = branch.match(new RegExp(`(?<![A-Za-z0-9])${ID.source}`));
  return m ? m[0].toUpperCase() : null;
}

/** A typed ticket id as `ABC-123`, or null if it is not one. */
export function normalizeTicketId(raw: string): string | null {
  const t = raw.trim();
  return new RegExp(`^${ID.source}$`).test(t) ? t.toUpperCase() : null;
}
