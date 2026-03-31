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

/**
 * Parse a raw unified diff string (output of `git diff`) into structured data.
 */
export function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];

  const files: DiffFile[] = [];
  // Split on file boundaries: "diff --git a/... b/..."
  const fileParts = raw.split(/^diff --git /m).filter(Boolean);

  for (const part of fileParts) {
    const lines = part.split("\n");
    if (lines.length === 0) continue;

    // First line: "a/path b/path"
    const headerMatch = lines[0].match(/^a\/(.+?)\s+b\/(.+)/);
    const oldName = headerMatch?.[1] ?? "unknown";
    const newName = headerMatch?.[2] ?? "unknown";

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

    for (const line of lines.slice(1)) {
      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
      if (hunkMatch) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);

        currentHunk.lines.push({
          type: "hunk-header",
          content: hunkMatch[3]?.trim() || "",
          oldNum: null,
          newNum: null,
        });
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          oldNum: null,
          newNum: newLine++,
        });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "remove",
          content: line.slice(1),
          oldNum: oldLine++,
          newNum: null,
        });
      } else if (line.startsWith(" ") || line === "") {
        // Only treat as context if we're inside a hunk and the line starts with a space
        // (empty lines at the end of a part are just trailing newlines from the split)
        if (line.startsWith(" ")) {
          currentHunk.lines.push({
            type: "context",
            content: line.slice(1),
            oldNum: oldLine++,
            newNum: newLine++,
          });
        }
      }
      // Skip other metadata lines (---, +++, index, etc.)
    }

    files.push({ oldName, newName, changeType, hunks });
  }

  return files;
}
