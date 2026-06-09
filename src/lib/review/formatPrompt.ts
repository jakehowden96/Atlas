import type { ReviewComment } from "../stores/reviewComments";

/**
 * Format a batch of review comments into the prompt Atlas pastes into the
 * Claude Code PTY. Includes the ack-file path so Claude can mark each item
 * complete via `echo <id> >> <path>` — Atlas's file watcher picks that up and
 * removes the comment from the drawer.
 */
export function formatReviewPrompt(
  comments: ReviewComment[],
  ackFilePath: string,
): string {
  const lines: string[] = [];
  lines.push("Please address these review comments from Atlas, in order.");
  lines.push("After completing each item, run:");
  lines.push(`  echo <id> >> ${ackFilePath}`);
  lines.push("");

  for (const c of comments) {
    const a = c.anchor;
    // Prefer the newNum (the "live" side after the change). Falling back to
    // oldNum keeps deleted-line comments addressable.
    const lineNum = a.newNum ?? a.oldNum ?? 0;
    lines.push(`[${c.shortId}] ${a.fileKey}:${lineNum}`);
    if (a.hunkHeader) {
      lines.push(`   (hunk: ${a.hunkHeader})`);
    }
    lines.push(`   > ${a.contentSnippet}`);
    // Indent body lines so it reads as one block.
    for (const bodyLine of c.body.split("\n")) {
      lines.push(`   ${bodyLine}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
