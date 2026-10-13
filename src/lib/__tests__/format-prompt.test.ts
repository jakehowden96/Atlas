import { describe, expect, it } from "vitest";
import { formatReviewPrompt } from "../review/formatPrompt";
import type { ReviewComment } from "../stores/reviewComments";

function comment(
  overrides: { snippet?: string; body?: string; fileKey?: string } = {},
): ReviewComment {
  return {
    id: "c1",
    sessionId: "t1",
    body: overrides.body ?? "please rename this",
    createdAt: 0,
    anchor: {
      fileKey: overrides.fileKey ?? "src/a.ts",
      side: "+",
      oldNum: null,
      newNum: 12,
      hunkHeader: "@@ -1 +12 @@",
      contentSnippet: overrides.snippet ?? "const x = 1;",
    },
  };
}

describe("formatReviewPrompt", () => {
  it("keeps a diff line's carriage return from submitting the prompt early", () => {
    const prompt = formatReviewPrompt([comment({ snippet: "foo\r" })]);
    expect(prompt).not.toContain("\r");
  });

  it("keeps control bytes from repo content out of the terminal", () => {
    const prompt = formatReviewPrompt([
      comment({ snippet: "a\x03b\x1b[2Jc\x7f", body: "x\x1b]0;evil\x07y", fileKey: "we\x03ird" }),
    ]);
    expect(prompt).not.toMatch(/\p{Cc}(?<!\n)/u);
  });

  it("caps an unbounded snippet such as a minified line", () => {
    const prompt = formatReviewPrompt([comment({ snippet: "x".repeat(50_000) })]);
    expect(prompt.length).toBeLessThan(1000);
  });

  it("keeps a multi-line comment body as one indented block", () => {
    const prompt = formatReviewPrompt([comment({ body: "first\r\nsecond" })]);
    expect(prompt).toContain("   first\n   second");
  });
});
