import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { log } from "../logger";
import { themeMode, type ThemeMode } from "../theme";

export const settingsOpen = writable(false);
export const skipPermissions = writable(false);
export const enableNotifications = writable(true);
export const watchedRepos = writable<string[]>([]);
/** How often the Pull requests screen re-polls `gh`, in minutes. */
export const prRefreshMinutes = writable(3);
/** xterm font size in px. The design specifies 12.5; phase 11 adds the stepper. */
export const terminalFontSize = writable(12.5);

const SETTINGS_DIR = ".atlas";
const SETTINGS_FILE = ".atlas/settings.json";

interface PersistedSettings {
  skipPermissions?: boolean;
  enableNotifications?: boolean;
  watchedRepos?: string[];
  prRefreshMinutes?: number;
  terminalFontSize?: number;
  theme?: ThemeMode;
}

/** The three intervals the Pull requests screen offers; phase 11 adds the UI. */
const PR_REFRESH_CHOICES = [1, 3, 10];

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
    if (PR_REFRESH_CHOICES.includes(data.prRefreshMinutes as number)) {
      prRefreshMinutes.set(data.prRefreshMinutes as number);
    }
    if (typeof data.terminalFontSize === "number" && data.terminalFontSize > 0) {
      terminalFontSize.set(data.terminalFontSize);
    }
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
      prRefreshMinutes: get(prRefreshMinutes),
      terminalFontSize: get(terminalFontSize),
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

