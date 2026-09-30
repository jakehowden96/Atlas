import { getCurrentWindow } from "@tauri-apps/api/window";
import { derived, get, writable, type Writable } from "svelte/store";
import type { DirEntry, DocEntry, PlanEntry, TextFile } from "../../types/files";
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
import { openFiles, sources } from "./file-tabs";
import { setFileSources, setOpenFiles } from "./settings";
import { showToast } from "./toast";
import { showView } from "./view";

/** Workspace path whose documents the tree column is showing. */
export const fileWs = writable<string>("");
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
/** Keys whose file failed to load. They open read-only and cannot be saved. */
export const unreadable = writable<Set<string>>(new Set());
/** Keys with unsaved edits whose file changed on disk underneath them. */
export const conflicts = writable<Set<string>>(new Set());
/** The modification time each open file had when we last read or wrote it. A
 *  save hands it back so the backend can tell the file changed in between. A
 *  key with no entry (a brand-new note) saves unconditionally. */
const diskMtimes = new Map<string, number>();
/** The disk's newer time for a key in `conflicts`, taken on "keep mine". Null
 *  means the file is gone. */
const conflictMtimes = new Map<string, number | null>();

/** Why the tree is empty when a listing failed; `""` when the last one worked. */
export const listError = writable("");

/** The backend's walk of the shown workspace hit a cap, so `docEntries` is
 *  incomplete. The tree says so rather than looking merely empty. */
export const docsTruncated = writable(false);
/** Registered folders whose listing was cut at the backend's cap. */
export const truncatedSources = writable<Set<string>>(new Set());

/** Refresh the workspace listing. A workspace that cannot be walked lists as
 *  empty and sets `listError`, which the tree shows. */
export async function loadDocs(workspacePath: string): Promise<void> {
  if (!workspacePath) {
    docEntries.set([]);
    docsTruncated.set(false);
    return;
  }
  try {
    const listing = await listWorkspaceDocs(workspacePath);
    docEntries.set(listing.entries);
    docsTruncated.set(listing.truncated);
    listError.set("");
  } catch (e) {
    log.error("files", `listWorkspaceDocs failed for ${workspacePath}`, e);
    listError.set(`Could not list ${workspacePath}: ${String(e)}`);
    docEntries.set([]);
    docsTruncated.set(false);
  }
}

/** Every plan in `~/.claude/plans`; the tree filters them to one workspace. */
export async function loadPlans(): Promise<void> {
  try {
    plans.set(await listClaudePlans());
  } catch (e) {
    log.error("files", "listClaudePlans failed", e);
    listError.set(`Could not list Claude plans: ${String(e)}`);
    plans.set([]);
  }
}

/** List every registered folder, replacing whatever `sourceFiles` held. A
 *  folder that has gone lists as empty rather than dropping itself — forgetting
 *  one is the user's call. */
export async function loadSourceFiles(paths: string[]): Promise<void> {
  const next = new Map<string, DirEntry[]>();
  const cut = new Set<string>();
  for (const dir of paths) {
    try {
      const listing = await listDir(dir);
      next.set(
        dir,
        listing.entries.filter((entry) => entry.is_text),
      );
      if (listing.truncated) cut.add(dir);
    } catch (e) {
      log.error("files", `listDir failed for ${dir}`, e);
      listError.set(`Could not list ${dir}: ${String(e)}`);
      next.set(dir, []);
    }
  }
  sourceFiles.set(next);
  truncatedSources.set(cut);
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
  setMember(unreadable, key, false);
  setMember(conflicts, key, false);
  diskMtimes.delete(key);
  conflictMtimes.delete(key);
  if (get(activeFile) === key) activeFile.set(next[at] ?? next[at - 1] ?? "");
}

export function setDoc(key: string, text: string): void {
  ensureQuitGuard();
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
 *  cannot be read opens empty but is recorded in `unreadable`: the editor shows
 *  it read-only and saving is refused, so the empty buffer can never replace the
 *  real file on disk. */
export async function loadFileText(key: string): Promise<void> {
  if (!key || get(diskDocs).has(key)) return;
  // A brand-new note is an unsaved buffer with nothing on disk to read yet.
  if (get(docs).has(key)) return;
  const { source, path } = parseFileKey(key);
  try {
    const file = await readTextFileAt(absolutePath(source, path));
    setDiskDoc(key, file.contents);
    diskMtimes.set(key, file.mtime);
  } catch (e) {
    log.error("files", `read failed for ${key}`, e);
    showToast("Could not open that file", { body: String(e) });
    setMember(unreadable, key, true);
    setDiskDoc(key, "");
  }
}

/** Write the active file's pending edit to disk. A failed write keeps the edit,
 *  so the only thing lost is the save. */
export async function saveActiveFile(): Promise<void> {
  await saveFile(get(activeFile));
}

/** Write one file's pending edit to disk. */
async function saveFile(key: string): Promise<void> {
  const text = get(docs).get(key);
  if (!key || text === undefined || get(unreadable).has(key)) return;
  if (get(conflicts).has(key)) {
    showToast("File changed on disk", {
      body: "Reload it or keep your version before saving.",
      type: "warning",
    });
    return;
  }
  const { source, path } = parseFileKey(key);
  // The editor hands back LF whatever the file used, so the file's own endings
  // are restored from the text it was read with.
  const out = matchLineEndings(text, get(diskDocs).get(key));
  try {
    const outcome = await writeTextFileAt(
      absolutePath(source, path),
      out,
      diskMtimes.get(key) ?? null,
    );
    if (outcome.kind === "conflict") {
      // Someone else saved (or deleted) the file since it was read; the edit
      // stays, unsaved, until the user picks reload or keep-mine.
      conflictMtimes.set(key, outcome.diskMtime);
      setMember(conflicts, key, true);
      showToast("File changed on disk", {
        body: "Reload it or keep your version before saving.",
        type: "warning",
      });
      return;
    }
    diskMtimes.set(key, outcome.mtime);
    // What was just written is now what is on disk, so the editor keeps showing
    // it the moment the unsaved edit is dropped — and the next save can still
    // see which endings the file has.
    setDiskDoc(key, out);
    // Keystrokes that landed while the write was in flight are not on disk;
    // dropping the doc would lose them. They stay as a fresh unsaved edit.
    if (get(docs).get(key) === text) dropDoc(key);
  } catch (e) {
    log.error("files", `save failed for ${key}`, e);
    showToast("Could not save", { body: String(e) });
  }
}

/** Add or remove `key` in a set store, leaving the set alone if nothing changes. */
function setMember(store: Writable<Set<string>>, key: string, present: boolean) {
  store.update((current) => {
    if (current.has(key) === present) return current;
    const next = new Set(current);
    if (present) next.add(key);
    else next.delete(key);
    return next;
  });
}

/** What the unsaved-changes dialog is asking about: one tab, or quitting Atlas. */
export type CloseRequest = { kind: "tab"; key: string } | { kind: "quit" };
export const closeRequest = writable<CloseRequest | null>(null);

/** Close a tab, asking first if it holds unsaved edits. */
export function requestCloseFile(key: string): void {
  if (get(dirtyFiles).has(key)) closeRequest.set({ kind: "tab", key });
  else closeFile(key);
}

/** Act on the user's answer to the unsaved-changes dialog. A save that fails
 *  leaves the file dirty, and then nothing closes — the edit is never traded
 *  for the exit. */
export async function resolveCloseRequest(choice: "save" | "discard" | "cancel"): Promise<void> {
  const request = get(closeRequest);
  closeRequest.set(null);
  if (!request || choice === "cancel") return;
  if (request.kind === "tab") {
    if (choice === "save") {
      await saveFile(request.key);
      if (get(dirtyFiles).has(request.key)) return;
    }
    closeFile(request.key);
    return;
  }
  if (choice === "save") {
    for (const key of get(dirtyFiles)) await saveFile(key);
    if (get(dirtyFiles).size > 0) return;
  }
  await getCurrentWindow().destroy();
}

let quitGuarded = false;

/** Intercept the window's close while any file has unsaved edits. Registered on
 *  the first edit rather than at startup, so it costs nothing until it matters.
 *  Unedited windows close as before: the handler only prevents when dirty. */
function ensureQuitGuard(): void {
  if (quitGuarded) return;
  quitGuarded = true;
  getCurrentWindow()
    .onCloseRequested((event) => {
      if (get(dirtyFiles).size === 0) return;
      event.preventDefault();
      // The dialog lives in the Files view; bring it up wherever the user is.
      showView("files");
      closeRequest.set({ kind: "quit" });
    })
    .catch((e) => {
      quitGuarded = false;
      log.warn("files", `could not guard window close: ${e}`);
    });
}

/**
 * A file under the watched workspace changed on disk. Nothing happens unless it
 * is open here. A clean tab is re-read so it shows what is on disk; a tab with
 * unsaved edits is flagged in `conflicts` instead, so the user's typing is never
 * replaced silently. Our own saves echo through here too, and are recognised by
 * the disk text already matching what was last written.
 */
export async function handleExternalChange(workspacePath: string, relPath: string): Promise<void> {
  const key = fileKey(workspacePath, relPath);
  if (!get(openFiles).includes(key) || get(unreadable).has(key)) return;
  const known = get(diskDocs).get(key);
  if (known === undefined) return;
  let latest: TextFile;
  try {
    latest = await readTextFileAt(absolutePath(workspacePath, relPath));
  } catch (e) {
    // Deleted or unreadable now: keep what the editor has rather than blanking it.
    log.warn("files", `re-read failed for ${key}: ${e}`);
    return;
  }
  if (latest.contents === known) {
    // Touched without a change (or our own save echoing): take the new time so
    // the next save does not mistake it for someone else's edit.
    if (!get(conflicts).has(key)) diskMtimes.set(key, latest.mtime);
    return;
  }
  if (get(docs).has(key)) {
    conflictMtimes.set(key, latest.mtime);
    setMember(conflicts, key, true);
  } else {
    setDiskDoc(key, latest.contents);
    diskMtimes.set(key, latest.mtime);
  }
}

/** Conflict resolution: discard the unsaved edit and show what is on disk now. */
export async function reloadFromDisk(key: string): Promise<void> {
  const { source, path } = parseFileKey(key);
  try {
    const file = await readTextFileAt(absolutePath(source, path));
    setDiskDoc(key, file.contents);
    diskMtimes.set(key, file.mtime);
  } catch (e) {
    log.error("files", `reload failed for ${key}`, e);
    showToast("Could not reload that file", { body: String(e) });
    return;
  }
  dropDoc(key);
  conflictMtimes.delete(key);
  setMember(conflicts, key, false);
}

/** Conflict resolution: keep the unsaved edit, so the next save overwrites the
 *  disk. The save now expects the time the disk has, so it goes through once —
 *  and a file that was deleted is written fresh. */
export function keepMine(key: string): void {
  const newer = conflictMtimes.get(key);
  if (newer === undefined || newer === null) diskMtimes.delete(key);
  else diskMtimes.set(key, newer);
  conflictMtimes.delete(key);
  setMember(conflicts, key, false);
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
