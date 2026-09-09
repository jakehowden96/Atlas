import { derived, get, writable } from "svelte/store";
import type { DirEntry, DocEntry, PlanEntry } from "../../types/files";
import {
  absolutePath,
  ancestorPaths,
  fileKey,
  matchLineEndings,
  parseFileKey,
  type FileSource,
} from "../files";
import {
  listClaudePlans,
  listDir,
  listWorkspaceDocs,
  readTextFileAt,
  writeTextFileAt,
} from "../ipc";
import { log } from "../logger";
import type { OutlineItem } from "../markdown";
import { setFileSources, setOpenFiles } from "./settings";
import { showToast } from "./toast";

/** Workspace path whose documents the tree column is showing. */
export const fileWs = writable<string>("");
/** Open file keys in tab order. Persisted — see `stores/settings.ts`. */
export const openFiles = writable<string[]>([]);
/** The key of the file the editor is showing; `""` when nothing is open. */
export const activeFile = writable<string>("");
export const fileMode = writable<"source" | "split" | "preview">("source");
/** Unsaved edits by file key. A key is present only while it differs from disk. */
export const docs = writable<Map<string, string>>(new Map());
/** Last-known text on disk, by file key. The editor shows `docs` when a file
 *  has an unsaved edit and this otherwise, so a save has something to fall back
 *  to the instant the edit is dropped. Filled by `loadFileText`. */
export const diskDocs = writable<Map<string, string>>(new Map());
/** Expanded folders, keyed like a file so the state is per workspace.
 *
 *  Tracking what is *open* rather than what is shut makes "collapsed" the
 *  empty-set case: a tree opens fully shut with nothing to seed, and a
 *  directory the docs watcher only discovers on a later re-list starts shut
 *  too rather than popping open. Nothing here is persisted, so an old settings
 *  file is unaffected. */
export const expanded = writable<Set<string>>(new Set());
/** Folders registered from disk. Phase 04 lists them; persisted like `openFiles`. */
export const sources = writable<string[]>([]);
/** The text files directly inside each registered source, by folder path.
 *  The browser walks a folder at a time, so the tree lists one level too. */
export const sourceFiles = writable<Map<string, DirEntry[]>>(new Map());

/** The heading the rail last asked the editor to scroll to. `nonce` rises on
 *  every click, so asking twice for the same heading scrolls twice. */
export const outlineJump = writable<{ id: string; line: number; nonce: number } | null>(null);

/** The shown workspace's listing and every Claude plan on disk. The tree draws
 *  from these, and phase 05's palette indexes them. */
export const docEntries = writable<DocEntry[]>([]);
export const plans = writable<PlanEntry[]>([]);

/** Keys with unsaved edits, derived once rather than in each component. */
export const dirtyFiles = derived(docs, ($docs) => new Set($docs.keys()));

/** Refresh the workspace listing. A workspace that cannot be walked lists as
 *  empty rather than throwing — the tree has nowhere to show an error. */
export async function loadDocs(workspacePath: string): Promise<void> {
  if (!workspacePath) {
    docEntries.set([]);
    return;
  }
  try {
    docEntries.set(await listWorkspaceDocs(workspacePath));
  } catch (e) {
    log.error("files", `listWorkspaceDocs failed for ${workspacePath}`, e);
    docEntries.set([]);
  }
}

/** Every plan in `~/.claude/plans`; the tree filters them to one workspace. */
export async function loadPlans(): Promise<void> {
  try {
    plans.set(await listClaudePlans());
  } catch (e) {
    log.error("files", "listClaudePlans failed", e);
    plans.set([]);
  }
}

/** List every registered folder, replacing whatever `sourceFiles` held. A
 *  folder that has gone lists as empty rather than dropping itself — forgetting
 *  one is the user's call. */
export async function loadSourceFiles(paths: string[]): Promise<void> {
  const next = new Map<string, DirEntry[]>();
  for (const dir of paths) {
    try {
      next.set(dir, (await listDir(dir)).filter((entry) => entry.is_text));
    } catch (e) {
      log.error("files", `listDir failed for ${dir}`, e);
      next.set(dir, []);
    }
  }
  sourceFiles.set(next);
}

/** Register a folder under "From disk". The tree lists it from `sources`. */
export async function addSource(path: string): Promise<void> {
  const current = get(sources);
  if (current.includes(path)) return;
  await setFileSources([...current, path]);
}

/** Forget a folder. Nothing on disk is touched and open tabs stay open. */
export async function removeSource(path: string): Promise<void> {
  await setFileSources(get(sources).filter((p) => p !== path));
}

/** Ask the editor to scroll to a heading the outline rail was clicked on. */
export function jumpToHeading(item: OutlineItem): void {
  outlineJump.update((current) => ({
    id: item.id,
    line: item.line,
    nonce: (current?.nonce ?? 0) + 1,
  }));
}

export function openFile(source: FileSource, path: string): void {
  const key = fileKey(source, path);
  const current = get(openFiles);
  if (!current.includes(key)) void setOpenFiles([...current, key]);
  activeFile.set(key);
  revealFile(source, path);
}

export function closeFile(key: string): void {
  const current = get(openFiles);
  const at = current.indexOf(key);
  if (at === -1) return;
  const next = current.filter((k) => k !== key);
  void setOpenFiles(next);
  // The unsaved edit goes with the tab: with no tab left nothing can reach it,
  // and `dirtyFiles` would otherwise report it as unsaved forever. The cached
  // disk text goes too, so reopening the file shows what is on disk now.
  dropDoc(key);
  diskDocs.update((current) => {
    if (!current.has(key)) return current;
    const next = new Map(current);
    next.delete(key);
    return next;
  });
  if (get(activeFile) === key) activeFile.set(next[at] ?? next[at - 1] ?? "");
}

export function setDoc(key: string, text: string): void {
  docs.update((current) => {
    const next = new Map(current);
    next.set(key, text);
    return next;
  });
}

function dropDoc(key: string) {
  docs.update((current) => {
    if (!current.has(key)) return current;
    const next = new Map(current);
    next.delete(key);
    return next;
  });
}

function setDiskDoc(key: string, text: string) {
  diskDocs.update((current) => new Map(current).set(key, text));
}

/** Read a file's text into `diskDocs` unless it is already known. A file that
 *  cannot be read opens empty with a toast rather than leaving the editor
 *  stuck on the file before it. */
export async function loadFileText(key: string): Promise<void> {
  if (!key || get(diskDocs).has(key)) return;
  // A brand-new note is an unsaved buffer with nothing on disk to read yet.
  if (get(docs).has(key)) return;
  const { source, path } = parseFileKey(key);
  try {
    setDiskDoc(key, await readTextFileAt(absolutePath(source, path)));
  } catch (e) {
    log.error("files", `read failed for ${key}`, e);
    showToast("Could not open that file", { body: String(e) });
    setDiskDoc(key, "");
  }
}

/** Write the active file's pending edit to disk. A failed write keeps the edit,
 *  so the only thing lost is the save. */
export async function saveActiveFile(): Promise<void> {
  const key = get(activeFile);
  const text = get(docs).get(key);
  if (!key || text === undefined) return;
  const { source, path } = parseFileKey(key);
  // The editor hands back LF whatever the file used, so the file's own endings
  // are restored from the text it was read with.
  const out = matchLineEndings(text, get(diskDocs).get(key));
  try {
    await writeTextFileAt(absolutePath(source, path), out);
    // What was just written is now what is on disk, so the editor keeps showing
    // it the moment the unsaved edit is dropped — and the next save can still
    // see which endings the file has.
    setDiskDoc(key, out);
    dropDoc(key);
  } catch (e) {
    log.error("files", `save failed for ${key}`, e);
    showToast("Could not save", { body: String(e) });
  }
}

export function toggleExpanded(key: string): void {
  expanded.update((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

/**
 * Open the folders on the way to a file so its row is on screen.
 *
 * Every folder starts shut, so a file reached from ⌘K, the Open… dialog or a
 * cross-link would otherwise be selected while hidden several levels down.
 * Only the workspace tree has folder rows — plans and disk files list flat —
 * so the synthetic sources have nothing to reveal.
 */
function revealFile(source: FileSource, path: string): void {
  if (source === "plans" || source === "disk") return;
  const ancestors = ancestorPaths(path);
  if (ancestors.length === 0) return;
  expanded.update((current) => {
    const next = new Set(current);
    for (const dir of ancestors) next.add(fileKey(source, dir));
    return next;
  });
}

// Showing another workspace's tree starts it fully collapsed. This is a
// subscription rather than something the tree column does on show because the
// picker is not the only writer — the session rail's cross-link and the jump
// palette both set `fileWs` directly — and because it lands before the setter's
// next line, so an `openFile` that follows a workspace switch still reveals.
let shownWs = get(fileWs);
fileWs.subscribe((ws) => {
  if (ws === shownWs) return;
  shownWs = ws;
  expanded.set(new Set());
});
