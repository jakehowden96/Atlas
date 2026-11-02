import { getCurrentWebview } from "@tauri-apps/api/webview";
import { get, writable } from "svelte/store";
import { classifyPaths } from "./ipc";
import { addWorkspace, workspaces } from "./stores/workspace";
import { showToast } from "./stores/toast";

export type DragState = { kind: "idle" } | { kind: "over"; folders: number; files: number };

export const dragState = writable<DragState>({ kind: "idle" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Sub-text under the overlay headline. */
export function dropHint(s: DragState): string {
  if (s.kind === "idle") return "";
  if (s.folders === 0) return "Only folders can be added";
  return plural(s.folders, "folder");
}

/** Drag started over the window: classify what is being carried. */
export async function dragEntered(paths: string[]) {
  const found = await classifyPaths(paths);
  const folders = found.filter((p) => p.isDir).length;
  dragState.set({ kind: "over", folders, files: found.length - folders });
}

export function dragLeft() {
  dragState.set({ kind: "idle" });
}

/** Add each dropped folder as a workspace; files are skipped with a message. */
export async function handleDrop(paths: string[]) {
  dragLeft();
  const found = await classifyPaths(paths);
  const folders = found.filter((p) => p.isDir).map((p) => p.path);
  const skipped = found.length - folders.length;
  const known = new Set(get(workspaces).map((w) => w.path));
  const fresh = folders.filter((p) => !known.has(p));
  let added = 0;
  for (const p of fresh) if (await addWorkspace(p)) added++;

  if (added > 0) {
    showToast(added === 1 ? "Added 1 workspace" : `Added ${added} workspaces`, {
      type: "success",
      body: skipped > 0 ? `Skipped ${plural(skipped, "file")}` : undefined,
    });
  } else if (folders.length > 0) {
    showToast("Already added", { type: "info" });
  } else if (skipped > 0) {
    showToast(`Skipped ${plural(skipped, "file")}`, { body: "Only folders can be added" });
  }
}

/** Subscribe to the webview's drag-drop events. Returns the unsubscribe. */
export async function startDropListener(): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter") void dragEntered(p.paths);
    else if (p.type === "leave") dragLeft();
    else if (p.type === "drop") void handleDrop(p.paths);
  });
}
