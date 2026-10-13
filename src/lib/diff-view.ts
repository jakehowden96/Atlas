import type { DiffFile, DiffHunk } from "./diff-parser";

// Pure helpers shared by the Changes drawer and its subcomponents
// (DiffFileTree, DiffFileCard). Extracted so the logic is unit-testable.

/** Flat list entry: a parsed file with pre-computed +/- counts. */
export type FlatFile = {
  key: string;
  file: DiffFile;
  addedCount: number;
  removedCount: number;
};

export function toFlat(file: DiffFile, key: string): FlatFile {
  let added = 0;
  let removed = 0;
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.type === "add") added++;
      else if (l.type === "remove") removed++;
    }
  }
  return { key, file, addedCount: added, removedCount: removed };
}

// git diff can emit the same path twice (e.g. .csproj.lscache appearing in
// both worktree and index). Suffix duplicates so keyed {#each} stays unique.
export function dedupeKeys(items: FlatFile[]): FlatFile[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = seen.get(item.key) ?? 0;
    seen.set(item.key, n + 1);
    return n === 0 ? item : { ...item, key: `${item.key}#${n}` };
  });
}

// ---------- File tree ----------

export type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  fileKey?: string;
  changeType?: DiffFile["changeType"];
};

export function buildTree(items: FlatFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const item of items) {
    const parts = item.key.split("/");
    let node = root;
    let acc = "";
    for (const [i, part] of parts.entries()) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: acc, children: new Map() };
        node.children.set(part, child);
      }
      if (i === parts.length - 1) {
        child.fileKey = item.key;
        child.changeType = item.file.changeType;
      }
      node = child;
    }
  }
  return root;
}

export function matchesFilter(node: TreeNode, filter: string): boolean {
  if (!filter.trim()) return true;
  const needle = filter.toLowerCase();
  if (node.fileKey) return node.path.toLowerCase().includes(needle);
  for (const child of node.children.values()) {
    if (matchesFilter(child, filter)) return true;
  }
  return false;
}

// Sort children: directories first, then files alphabetically
export function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const aIsDir = !a.fileKey;
    const bIsDir = !b.fileKey;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------- Misc display helpers ----------

// Status letter for tree icon (GitHub-style)
export function statusLetter(t?: DiffFile["changeType"]): string {
  switch (t) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

export function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
}

export function totalLines(file: DiffFile): number {
  return file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
}

// ---------- Render limits ----------
// Every diff line is an interactive row, so the DOM cost of a big diff is
// per line. These bound what is mounted without hiding anything permanently.

/** A file longer than this starts collapsed behind a "Show N lines" button. */
export const MAX_VISIBLE_LINES = 500;
/** Rows an expanded card mounts at a time; "Show more" adds another page. */
export const ROW_PAGE = 1500;
/** Lines the drawer mounts across its expanded files before collapsing the rest. */
export const TOTAL_LINE_BUDGET = 5000;

/** The first `limit` lines of `hunks`, and how many lines that leaves out. */
export function limitHunks(
  hunks: DiffHunk[],
  limit: number,
): { hunks: DiffHunk[]; hidden: number } {
  const total = hunks.reduce((sum, h) => sum + h.lines.length, 0);
  if (total <= limit) return { hunks, hidden: 0 };
  const kept: DiffHunk[] = [];
  let room = limit;
  for (const hunk of hunks) {
    if (room <= 0) break;
    kept.push(hunk.lines.length <= room ? hunk : { ...hunk, lines: hunk.lines.slice(0, room) });
    room -= hunk.lines.length;
  }
  return { hunks: kept, hidden: total - limit };
}

/**
 * Files that would push the drawer past `budget` mounted lines, so they start
 * collapsed like an oversized file does. The first file always fits; a file
 * already collapsed for its size costs nothing and is not counted.
 */
export function overBudgetKeys(items: FlatFile[], budget: number): Set<string> {
  const over = new Set<string>();
  let spent = 0;
  for (const item of items) {
    const lines = totalLines(item.file);
    if (lines > MAX_VISIBLE_LINES) continue;
    if (spent > 0 && spent + lines > budget) over.add(item.key);
    else spent += lines;
  }
  return over;
}

// ---------- Split view ----------

// Build paired lines for split view: align add/remove rows. Each non-hunk
// row carries the enclosing hunk so we can build a ReviewAnchor on click.
export type SplitRow =
  | { kind: "hunk"; header: string }
  | {
      kind: "context";
      hunk: DiffHunk;
      left: { num: number | null; content: string };
      right: { num: number | null; content: string };
    }
  | {
      kind: "change";
      hunk: DiffHunk;
      left: { num: number | null; content: string } | null;
      right: { num: number | null; content: string } | null;
    };

export function toSplitRows(file: DiffFile): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const hunk of file.hunks) {
    rows.push({ kind: "hunk", header: hunk.header });
    let pendingRemoves: { num: number | null; content: string }[] = [];
    let pendingAdds: { num: number | null; content: string }[] = [];
    const flushPair = () => {
      const max = Math.max(pendingRemoves.length, pendingAdds.length);
      for (let i = 0; i < max; i++) {
        rows.push({
          kind: "change",
          hunk,
          left: pendingRemoves[i] ?? null,
          right: pendingAdds[i] ?? null,
        });
      }
      pendingRemoves = [];
      pendingAdds = [];
    };
    for (const line of hunk.lines) {
      if (line.type === "hunk-header") continue;
      if (line.type === "remove") pendingRemoves.push({ num: line.oldNum, content: line.content });
      else if (line.type === "add") pendingAdds.push({ num: line.newNum, content: line.content });
      else {
        flushPair();
        rows.push({
          kind: "context",
          hunk,
          left: { num: line.oldNum, content: line.content },
          right: { num: line.newNum, content: line.content },
        });
      }
    }
    flushPair();
  }
  return rows;
}
