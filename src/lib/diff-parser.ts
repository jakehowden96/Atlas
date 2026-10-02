export type LineType = "context" | "add" | "remove" | "hunk-header";

export interface DiffLine {
  type: LineType;
  content: string;
  oldNum: number | null;
  newNum: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldName: string;
  newName: string;
  changeType: "modified" | "added" | "deleted" | "renamed";
  hunks: DiffHunk[];
}

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/**
 * Git quotes a path containing non-ASCII bytes, control characters, `"` or `\`
 * (under the default `core.quotepath`) as a C-style string: `"caf\303\251.txt"`.
 * Undo that; an unquoted path is returned as is.
 */
function unquoteGitPath(token: string): string {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return token;
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const chars = Array.from(token.slice(1, -1));
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "\\") {
      bytes.push(...encoder.encode(chars[i]));
      continue;
    }
    const octal = chars.slice(i + 1, i + 4).join("");
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
    } else {
      const escaped = chars[i + 1] ?? "\\";
      bytes.push(C_ESCAPES[escaped] ?? escaped.charCodeAt(0));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A name from a `---`/`+++` line: unquoted, without the `a/`/`b/` prefix and
 *  without the tab git appends after a name containing spaces. `null` for
 *  `/dev/null`, which marks the missing side of an added or deleted file. */
function diffLineName(rest: string): string | null {
  const name = unquoteGitPath(rest.replace(/\t.*$/, ""));
  if (name === "/dev/null") return null;
  return name.replace(/^[ab]\//, "");
}

const HEADER_NAMES = /^("(?:[^"\\]|\\.)+"|a\/.+?)\s+("(?:[^"\\]|\\.)+"|b\/.+)/;

/**
 * Parse a raw unified diff string (output of `git diff`) into structured data.
 */
export function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];

  const files: DiffFile[] = [];
  // Split on file boundaries: "diff --git a/... b/..."
  const fileParts = raw.split(/^diff --git /m).filter(Boolean);

  for (const part of fileParts) {
    // CRLF files leave a `\r` on every diff line.
    const lines = part.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    if (lines.length === 0) continue;

    // First line: "a/path b/path", or their quoted forms.
    const headerMatch = (lines[0] ?? "").match(HEADER_NAMES);
    let oldName = headerMatch ? (diffLineName(headerMatch[1] ?? "") ?? "unknown") : "unknown";
    let newName = headerMatch ? (diffLineName(headerMatch[2] ?? "") ?? "unknown") : "unknown";

    // Determine change type from diff metadata lines
    let changeType: DiffFile["changeType"] = "modified";
    for (const line of lines.slice(1, 8)) {
      if (line.startsWith("new file")) {
        changeType = "added";
        break;
      }
      if (line.startsWith("deleted file")) {
        changeType = "deleted";
        break;
      }
      if (line.startsWith("similarity index") || line.startsWith("rename from")) {
        changeType = "renamed";
        break;
      }
    }

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
    // Lines the current hunk still owes on each side, from its header counts.
    let oldRemaining = 0;
    let newRemaining = 0;

    for (const line of lines.slice(1)) {
      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/);
      if (hunkMatch) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1] ?? "0", 10);
        newLine = parseInt(hunkMatch[3] ?? "0", 10);
        oldRemaining = hunkMatch[2] === undefined ? 1 : parseInt(hunkMatch[2], 10);
        newRemaining = hunkMatch[4] === undefined ? 1 : parseInt(hunkMatch[4], 10);

        currentHunk.lines.push({
          type: "hunk-header",
          content: hunkMatch[5]?.trim() || "",
          oldNum: null,
          newNum: null,
        });
        continue;
      }

      if (!currentHunk) {
        // File metadata. The `---`/`+++`/rename lines name the file exactly,
        // where the `diff --git` line is ambiguous for a path containing " b/".
        if (line.startsWith("--- ")) oldName = diffLineName(line.slice(4)) ?? oldName;
        else if (line.startsWith("+++ ")) newName = diffLineName(line.slice(4)) ?? newName;
        else if (line.startsWith("rename from ")) oldName = unquoteGitPath(line.slice(12));
        else if (line.startsWith("rename to ")) newName = unquoteGitPath(line.slice(10));
        continue;
      }

      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          oldNum: null,
          newNum: newLine++,
        });
        newRemaining--;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "remove",
          content: line.slice(1),
          oldNum: oldLine++,
          newNum: null,
        });
        oldRemaining--;
      } else if (line.startsWith(" ") || (line === "" && oldRemaining > 0 && newRemaining > 0)) {
        // A context line. An empty one is a blank context line whose leading
        // space was stripped, but only while the hunk still expects context:
        // otherwise it is the trailing newline from the split.
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
          oldNum: oldLine++,
          newNum: newLine++,
        });
        oldRemaining--;
        newRemaining--;
      }
      // Skip other metadata lines (index, "\ No newline at end of file", …)
    }

    files.push({ oldName, newName, changeType, hunks });
  }

  return files;
}
