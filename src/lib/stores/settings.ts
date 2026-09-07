import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { log } from "../logger";
import { themeMode, type ThemeMode } from "../theme";

export const settingsOpen = writable(false);
export const skipPermissions = writable(false);
export const enableNotifications = writable(true);
export const watchedRepos = writable<string[]>([]);

const SETTINGS_DIR = ".atlas";
const SETTINGS_FILE = ".atlas/settings.json";

interface PersistedSettings {
  skipPermissions?: boolean;
  enableNotifications?: boolean;
  watchedRepos?: string[];
  theme?: ThemeMode;
}

async function ensureDir() {
  const dirExists = await exists(SETTINGS_DIR, { baseDir: BaseDirectory.Home });
  if (!dirExists) {
    await mkdir(SETTINGS_DIR, { baseDir: BaseDirectory.Home });
  }
}

export async function loadSettings() {
  log.info("settings", "loadSettings started");
  try {
    const fileExists = await exists(SETTINGS_FILE, { baseDir: BaseDirectory.Home });
    log.info("settings", `exists check: ${fileExists}`);
    if (!fileExists) return;
    const raw = await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.Home });
    const data = JSON.parse(raw) as PersistedSettings;
    if (data.skipPermissions) skipPermissions.set(true);
    if (data.enableNotifications === false) enableNotifications.set(false);
    if (Array.isArray(data.watchedRepos)) watchedRepos.set(data.watchedRepos);
    if (data.theme === "system" || data.theme === "light" || data.theme === "dark") {
      themeMode.set(data.theme);
    }
    log.info("settings", "settings loaded");
  } catch (e) {
    log.error("settings", "failed to load settings", e);
    console.warn("Failed to load settings (using defaults):", e);
  }
}

async function persistSettings() {
  try {
    await ensureDir();
    const data: PersistedSettings = {
      skipPermissions: get(skipPermissions),
      enableNotifications: get(enableNotifications),
      watchedRepos: get(watchedRepos),
      theme: get(themeMode),
    };
    await writeTextFile(SETTINGS_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    log.error("settings", "failed to persist settings", e);
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

export async function setWatchedRepos(repos: string[]) {
  watchedRepos.set(repos);
  await persistSettings();
}

export async function setTheme(mode: ThemeMode) {
  themeMode.set(mode);
  await persistSettings();
}

