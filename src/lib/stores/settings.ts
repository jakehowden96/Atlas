import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";

export const settingsOpen = writable(false);
export const skipPermissions = writable(false);
export const enableNotifications = writable(true);

const SETTINGS_DIR = ".atlas";
const SETTINGS_FILE = ".atlas/settings.json";

interface PersistedSettings {
  skipPermissions?: boolean;
  enableNotifications?: boolean;
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
    if (data.enableNotifications === false) enableNotifications.set(false);
  } catch (e) {
    console.warn("Failed to load settings (using defaults):", e);
  }
}

async function persistSettings() {
  try {
    await ensureDir();
    const data: PersistedSettings = {
      skipPermissions: get(skipPermissions),
      enableNotifications: get(enableNotifications),
    };
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

export async function setEnableNotifications(value: boolean) {
  enableNotifications.set(value);
  await persistSettings();
}

