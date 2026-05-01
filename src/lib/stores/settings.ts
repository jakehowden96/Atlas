import { writable, derived, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { log } from "../logger";
import type { ToolSettings } from "../adapters/types";

export const settingsOpen = writable(false);
export const enableNotifications = writable(true);
export const selectedTool = writable<string>("claude-code");
export const toolSettings = writable<Record<string, ToolSettings>>({});

export const skipPermissions = derived(toolSettings, ($ts) =>
  !!$ts["claude-code"]?.skipPermissions,
);

const SETTINGS_DIR = ".atlas";
const SETTINGS_FILE = ".atlas/settings.json";

interface PersistedSettings {
  skipPermissions?: boolean;
  enableNotifications?: boolean;
  selectedTool?: string;
  toolSettings?: Record<string, ToolSettings>;
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

    if (data.enableNotifications === false) enableNotifications.set(false);

    if (data.selectedTool) {
      selectedTool.set(data.selectedTool);
    }

    if (data.toolSettings) {
      toolSettings.set(data.toolSettings);
    } else if (data.skipPermissions !== undefined) {
      // Migrate old flat skipPermissions into new nested structure
      toolSettings.set({
        "claude-code": { skipPermissions: data.skipPermissions },
      });
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
      selectedTool: get(selectedTool),
      enableNotifications: get(enableNotifications),
      toolSettings: get(toolSettings),
    };
    await writeTextFile(SETTINGS_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    log.error("settings", "failed to persist settings", e);
    console.error("Failed to persist settings:", e);
  }
}

export async function setSelectedTool(id: string) {
  selectedTool.set(id);
  await persistSettings();
}

export async function setToolSetting(adapterId: string, key: string, value: boolean | string) {
  toolSettings.update((ts) => ({
    ...ts,
    [adapterId]: { ...(ts[adapterId] ?? {}), [key]: value },
  }));
  await persistSettings();
}

export function getToolSettings(adapterId: string): ToolSettings {
  return get(toolSettings)[adapterId] ?? {};
}

export async function setEnableNotifications(value: boolean) {
  enableNotifications.set(value);
  await persistSettings();
}
