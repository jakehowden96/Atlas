import type { ReviewComment } from "../stores/reviewComments";

/**
 * Format a batch of review comments into the prompt Atlas pastes into the
 * Claude Code PTY.
 */
export function formatReviewPrompt(comments: ReviewComment[]): string {
  const lines: string[] = [];
  lines.push("Please address these review comments from Atlas, in order.");
  lines.push("");

  for (const [i, c] of comments.entries()) {
    const a = c.anchor;
    // Prefer the newNum (the "live" side after the change). Falling back to
    // oldNum keeps deleted-line comments addressable.
    const lineNum = a.newNum ?? a.oldNum ?? 0;
    lines.push(`[${i + 1}] ${a.fileKey}:${lineNum}`);
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
