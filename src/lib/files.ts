/**
 * Pure helpers behind the Files screen.
 *
 * The key format, the tree fold and the plan-to-workspace match live here
 * rather than in the components so they can be unit-tested without a Svelte
 * compiler (README → Conventions).
 */
import type { DocEntry, PlanEntry } from "../types/files";
import type { Workspace } from "./stores/workspace";

/**
 * Where an open file came from: a workspace path, or one of the two synthetic
 * sources. (TypeScript folds this to `string`; the union is documentation.)
 */
export type FileSource = string | "plans" | "disk";

/**
 * Separator between the two halves of a file key. The design sketched a space,
 * but both halves are filesystem paths and both can contain one
 * (`C:\Program Files\…`), so a space cannot be split back apart. The ASCII unit
 * separator cannot appear in a path on any platform Atlas runs on. Nothing
 * outside `fileKey`/`parseFileKey` knows what it is.
 */
const KEY_SEP = "\u001f";

/** The identity of an open file: its source plus its path within that source. */
export function fileKey(source: FileSource, path: string): string {
  return `${source}${KEY_SEP}${path}`;
}

/** Inverse of `fileKey`. A key with no separator is read as a bare disk path. */
export function parseFileKey(key: string): { source: FileSource; path: string } {
  const at = key.indexOf(KEY_SEP);
  if (at === -1) return { source: "disk", path: key };
  return { source: key.slice(0, at), path: key.slice(at + 1) };
}

/**
 * Where a key's file actually lives. `plans` and `disk` files carry an absolute
 * path already; a workspace source carries a path relative to the workspace.
 */
export function absolutePath(source: FileSource, path: string): string {
  if (source === "plans" || source === "disk") return path;
  return `${source.replace(/[\\/]+$/, "")}/${path}`;
}

// ---------- Doc tree ----------

/**
 * One node of the tree column.
 *
 * `diff-view.ts` has its own `TreeNode` for the Changes drawer, but that one is
 * built from `FlatFile`s and carries the diff's `changeType` — it does not fit a
 * listing that has real directory entries and no diff behind it.
 */
export interface TreeNode {
  name: string;
  /** Forward-slash path relative to the workspace root — `DocEntry.rel_path`. */
  relPath: string;
  isDir: boolean;
  children: TreeNode[];
}

/** Directories first, then case-insensitively by name — the backend's order. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

function sortNode(node: TreeNode) {
  node.children.sort(compareNodes);
  for (const child of node.children) sortNode(child);
}

/**
 * The flat listing folded into a nested tree.
 *
 * The backend sorts the flat list globally by name, which does not survive the
 * fold — a nested directory sorts by its own leaf name, so it can arrive before
 * the parent it belongs under. Each level is therefore re-sorted with the same
 * comparator, which leaves the backend's intended order intact.
 */
export function buildDocTree(entries: DocEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", relPath: "", isDir: true, children: [] };
  const byPath = new Map<string, TreeNode>();

  for (const entry of entries) {
    const parts = entry.rel_path.split("/").filter(Boolean);
    let parent = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      acc = acc ? `${acc}/${name}` : name;
      let node = byPath.get(acc);
      if (!node) {
        // Anything with a child below it is a directory, whether or not its own
        // entry has been seen yet.
        const isDir = i < parts.length - 1 || entry.is_dir;
        node = { name, relPath: acc, isDir, children: [] };
        byPath.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  sortNode(root);
  return root.children;
}

/** True when this file — or any file below this folder — has unsaved edits.
 *  `dirty` holds rel paths within the shown source, not full file keys. */
export function hasUnsavedUnder(node: TreeNode, dirty: ReadonlySet<string>): boolean {
  if (!node.isDir) return dirty.has(node.relPath);
  return node.children.some((child) => hasUnsavedUnder(child, dirty));
}

// ---------- Claude plans ----------

/** A path in the form Claude Code names its plan files after: lowercased, every
 *  run of non-alphanumerics collapsed to a single `-`, no `-` at either end. */
export function slugifyPath(path: string): string {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The workspace a plan belongs to, or null when none of them owns it.
 *
 * Plan stems are a slugified cwd plus a random suffix
 * (`c-users-me-github-atlas-atl-curried-thacker`), so the match is a prefix
 * test on the slug. The longest matching slug wins, so a workspace nested
 * inside another does not lose its plans to the parent.
 */
export function planWorkspace(plan: PlanEntry, workspaces: Workspace[]): string | null {
  const stem = plan.name.toLowerCase();
  let best: string | null = null;
  let bestLength = -1;
  for (const ws of workspaces) {
    const slug = slugifyPath(ws.path);
    if (!slug || !stem.startsWith(slug)) continue;
    if (slug.length > bestLength) {
      best = ws.path;
      bestLength = slug.length;
    }
  }
  return best;
}
