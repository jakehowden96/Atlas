import { derived, get, writable } from "svelte/store";
import type { DocEntry, PlanEntry } from "../../types/files";
import { absolutePath, fileKey, parseFileKey, type FileSource } from "../files";
import { listClaudePlans, listWorkspaceDocs, writeTextFileAt } from "../ipc";
import { log } from "../logger";
import { setOpenFiles } from "./settings";
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
/** Collapsed folders, keyed like a file so the state is per workspace. */
export const collapsed = writable<Set<string>>(new Set());
/** Folders registered from disk. Phase 04 lists them; persisted like `openFiles`. */
export const sources = writable<string[]>([]);

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

export function openFile(source: FileSource, path: string): void {
  const key = fileKey(source, path);
  const current = get(openFiles);
  if (!current.includes(key)) void setOpenFiles([...current, key]);
  activeFile.set(key);
}

export function closeFile(key: string): void {
  const current = get(openFiles);
  const at = current.indexOf(key);
  if (at === -1) return;
  const next = current.filter((k) => k !== key);
  void setOpenFiles(next);
  // The unsaved edit goes with the tab: with no tab left nothing can reach it,
  // and `dirtyFiles` would otherwise report it as unsaved forever.
  dropDoc(key);
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

/** Write the active file's pending edit to disk. A failed write keeps the edit,
 *  so the only thing lost is the save. */
export async function saveActiveFile(): Promise<void> {
  const key = get(activeFile);
  const text = get(docs).get(key);
  if (!key || text === undefined) return;
  const { source, path } = parseFileKey(key);
  try {
    await writeTextFileAt(absolutePath(source, path), text);
    dropDoc(key);
  } catch (e) {
    log.error("files", `save failed for ${key}`, e);
    showToast("Could not save", { body: String(e) });
  }
}

export function toggleCollapsed(key: string): void {
  collapsed.update((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}
