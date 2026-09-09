/**
 * Pure helpers behind the Files screen.
 *
 * The key format, the tree fold and the plan-to-workspace match live here
 * rather than in the components so they can be unit-tested without a Svelte
 * compiler (README → Conventions).
 */
import type { DocEntry, PlanEntry } from "../types/files";
import type { SessionTile } from "./overview";
import type { TouchedFile } from "./session-view";
import type { SessionState } from "../types/session";
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

/**
 * `text` with the line endings the file on disk was using.
 *
 * A textarea's value is newline-normalized to LF by both webviews, so an edit
 * to a CRLF file would otherwise rewrite every line ending in it the first
 * time it is saved — invisible on macOS, and a whole-file diff on Windows. The
 * first ending in `onDisk` decides; a file with none, or one that has never
 * been on disk, gets LF.
 */
export function matchLineEndings(text: string, onDisk: string | undefined): string {
  return onDisk?.match(/\r\n|\n/)?.[0] === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text;
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

/**
 * The folders on the way to a rel path, outermost first — the rows that have to
 * be open for it to be on screen. A path at the root of the tree has none.
 */
export function ancestorPaths(relPath: string): string[] {
  const parts = relPath.split("/").filter(Boolean);
  parts.pop();
  const out: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
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
 *
 * The stem's leading `-` is dropped first: a posix path starts with a
 * separator, and Claude Code keeps that as a dash in the sibling `projects/`
 * naming (`-Users-me-atlas`), while `slugifyPath` trims it. Without this every
 * macOS workspace matches nothing.
 */
export function planWorkspace(plan: PlanEntry, workspaces: Workspace[]): string | null {
  const stem = plan.name.toLowerCase().replace(/^-+/, "");
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

// ---------- Wikilinks ----------

/**
 * The rel path a `[[wikilink]]` names, or null when nothing in the listing
 * matches it. The whole path is tried first, then file names with and without
 * the `.md` the author is allowed to leave off.
 */
export function resolveWikilink(target: string, entries: DocEntry[]): string | null {
  const want = target.trim().toLowerCase();
  if (!want) return null;
  const wanted = [want, `${want}.md`];
  for (const entry of entries) {
    if (wanted.includes(entry.rel_path.toLowerCase())) return entry.rel_path;
  }
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (wanted.includes(name) || name.replace(/\.[^.]+$/, "") === want) return entry.rel_path;
  }
  return null;
}

// ---------- Folder browsing ----------

/** One clickable segment of the Open… dialog's path. */
export interface Crumb {
  label: string;
  /** The directory that segment names — where clicking it navigates. */
  path: string;
}

/**
 * A path broken into the directories on the way to it, root first.
 *
 * Both separators are accepted because the path comes back from the backend in
 * the platform's own form. A drive letter is its own root (`C:` → `C:\`); a
 * posix path's root is the leading `/`.
 */
export function breadcrumbs(path: string): Crumb[] {
  const windows = /^[A-Za-z]:/.test(path);
  const sep = windows ? "\\" : "/";
  const parts = path.split(/[\\/]+/);
  const crumbs: Crumb[] = [];
  let acc = windows ? `${parts[0]}\\` : "/";

  crumbs.push({ label: windows ? parts[0] : "/", path: acc });
  for (const part of parts.slice(1)) {
    if (!part) continue;
    acc = acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** The directory holding `path`, or null when it is already a root. */
export function parentDir(path: string): string | null {
  const crumbs = breadcrumbs(path);
  return crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null;
}

// ---------- Sessions touching a file ----------

/** A session that has edited the file the rail is showing. */
export interface FileTouch {
  /** Atlas session id — what `focusedSessionId` takes. */
  sessionId: string;
  label: string;
  state: SessionState;
  added: number;
  removed: number;
}

/**
 * Separator-agnostic path compare, folding case.
 *
 * Both halves come from the same workspace string, so folding case cannot
 * introduce a false match here — it only absorbs a drive letter that git and
 * the workspace store spell differently.
 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The sessions whose working tree has this file changed, with that session's
 * own line counts for it.
 *
 * `TouchedFile.path` is relative to the repo the git diff came from, so the
 * absolute path is the workspace plus that repo plus the path. `repo` is ""
 * for a workspace that is itself one repo, which is the common case and leaves
 * the join unchanged.
 */
export function touchedBy(
  absPath: string,
  tiles: SessionTile[],
  touched: ReadonlyMap<string, TouchedFile[]>,
): FileTouch[] {
  if (!absPath) return [];
  const out: FileTouch[] = [];
  for (const tile of tiles) {
    if (!tile.workspacePath || !tile.terminalTabId) continue;
    const files = touched.get(tile.terminalTabId);
    const hit = files?.find((f) =>
      samePath(
        [tile.workspacePath, f.repo, f.path].filter(Boolean).join("/"),
        absPath,
      ),
    );
    if (!hit) continue;
    out.push({
      sessionId: tile.atlasSessionId,
      label: tile.label,
      state: tile.state,
      added: hit.added,
      removed: hit.removed,
    });
  }
  return out;
}
