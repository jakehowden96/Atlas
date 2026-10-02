import type { ReviewComment } from "../stores/reviewComments";

/** A quoted diff line longer than this is a minified bundle, not something a
 *  reviewer needs echoed back verbatim. */
const MAX_SNIPPET_CHARS = 200;

/**
 * The prompt is typed into a live PTY, so every byte of repo-controlled text
 * (file names, diff lines) and of the comment body is input, not data: a
 * carriage return is Enter and submits the prompt mid-way, ESC starts a
 * terminal escape sequence, Ctrl-C interrupts the turn. Line breaks are
 * normalised to `\n` and every other control character is dropped.
 */
function printable(text: string, keepNewlines: boolean): string {
  const normalised = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  return keepNewlines
    ? normalised.replace(/(?!\n)\p{Cc}/gu, "")
    : normalised.replace(/\n/g, " ").replace(/\p{Cc}/gu, "");
}

function snippetOf(text: string): string {
  const line = printable(text, false).trim();
  return line.length > MAX_SNIPPET_CHARS ? `${line.slice(0, MAX_SNIPPET_CHARS)}…` : line;
}

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
    lines.push(`[${i + 1}] ${printable(a.fileKey, false)}:${lineNum}`);
    if (a.hunkHeader) {
      lines.push(`   (hunk: ${printable(a.hunkHeader, false)})`);
    }
    lines.push(`   > ${snippetOf(a.contentSnippet)}`);
    // Indent body lines so it reads as one block.
    for (const bodyLine of printable(c.body, true).split("\n")) {
      lines.push(`   ${bodyLine}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
