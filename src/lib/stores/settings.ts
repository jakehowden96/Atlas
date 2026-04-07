import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { getExcludedFolders, setExcludedFolders } from "../ipc";

export const excludedFolders = writable<string[]>([]);
export const settingsOpen = writable(false);
export const skipPermissions = writable(false);

const SETTINGS_DIR = ".atlas";
const SETTINGS_FILE = ".atlas/settings.json";

interface PersistedSettings {
  skipPermissions?: boolean;
}

async function ensureDir() {
  const dirExists = await exists(SETTINGS_DIR, { baseDir: BaseDirectory.Home });
  if (!dirExists) {
    await mkdir(SETTINGS_DIR, { baseDir: BaseDirectory.Home });
  }
}

export async function loadSettings() {
  try {
    const fileExists = await exists(SETTINGS_FILE, { baseDir: BaseDirectory.Home });
    if (!fileExists) return;
    const raw = await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.Home });
    const data = JSON.parse(raw) as PersistedSettings;
    if (data.skipPermissions) skipPermissions.set(true);
  } catch {
    // No file or corrupted — use defaults
  }
}

async function persistSettings() {
  try {
    await ensureDir();
    const data: PersistedSettings = { skipPermissions: get(skipPermissions) };
    await writeTextFile(SETTINGS_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    console.error("Failed to persist settings:", e);
  }
}

export async function setSkipPermissions(value: boolean) {
  skipPermissions.set(value);
  await persistSettings();
}

export async function loadExcludedFolders() {
  const folders = await getExcludedFolders();
  excludedFolders.set(folders);
}

export async function saveExcludedFolders(folders: string[]) {
  await setExcludedFolders(folders);
  excludedFolders.set(folders);
}
