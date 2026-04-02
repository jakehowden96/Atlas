import { writable } from "svelte/store";
import { getExcludedFolders, setExcludedFolders } from "../ipc";

export const excludedFolders = writable<string[]>([]);
export const settingsOpen = writable(false);

export async function loadExcludedFolders() {
  const folders = await getExcludedFolders();
  excludedFolders.set(folders);
}

export async function saveExcludedFolders(folders: string[]) {
  await setExcludedFolders(folders);
  excludedFolders.set(folders);
}
