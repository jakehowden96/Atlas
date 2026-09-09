import { derived, writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { startSessionTail, stopSessionTail } from "../ipc";
import {
  ACTIONS,
  DEFAULT_KEYMAP,
  formatBinding,
  mergeKeymap,
  type Action,
  type Binding,
  type Keymap,
} from "../keymap";
import { log } from "../logger";
import { themeMode, type ThemeMode } from "../theme";
import { openFiles, sources } from "./files";
import { liveSessions } from "./liveSessions";
import { workspaces } from "./workspace";

export type OverviewOrdering = "attention" | "workspace" | "manual";
export type PrRefreshMinutes = 1 | 3 | 10;

export const settingsOpen = writable(false);
export const enableNotifications = writable(true);
/** Repos the user typed in by hand. Auto-added ones are unioned in `stores/prs`. */
export const watchedRepos = writable<string[]>([]);
/** How often the Pull requests screen re-polls `gh`, in minutes. */
export const prRefreshMinutes = writable<PrRefreshMinutes>(3);
/** xterm font size in px. The design handoff specifies 12.5, but xterm derives
    cell metrics from this and a fractional size rounds unevenly across rows, so
    the terminal pane uses whole pixels. */
export const terminalFontSize = writable(13);
/** A short ping when a permission prompt appears. */
export const soundOnNeedsYou = writable(false);
/** Overview tile order. "attention" is the design default. */
export const overviewOrdering = writable<OverviewOrdering>("attention");
/** Union every workspace's GitHub remote into the watched-repo list. */
export const autoAddReposFromWorkspaces = writable(false);
/** Read `~/.claude/projects/**.jsonl` live. Off degrades Overview tiles. */
export const tailTranscripts = writable(true);
/** Overview tiles the user pinned, by `pinKey`. Pinned tiles sort above every
    other tile whatever the ordering is. */
export const pinnedSessions = writable<string[]>([]);
/** The global chords. `shortcuts.ts` dispatches through this, and
    `terminal-session.ts` passes exactly these through to the window handler. */
export const keymap = writable<Keymap>({ ...DEFAULT_KEYMAP });

/** Chord labels for the UI, so every hint renders the current binding. */
export const chords = derived(keymap, (km) => {
  const labels = {} as Record<Action, string>;
  for (const action of ACTIONS) labels[action] = formatBinding(km[action]);
  return labels;
});

const SETTINGS_DIR = ".atlas";
const SETTINGS_FILE = ".atlas/settings.json";

interface PersistedSettings {
  enableNotifications?: boolean;
  watchedRepos?: string[];
  theme?: ThemeMode;
  soundOnNeedsYou?: boolean;
  terminalFontSize?: number;
  overviewOrdering?: OverviewOrdering;
  prRefreshMinutes?: PrRefreshMinutes;
  autoAddReposFromWorkspaces?: boolean;
  tailTranscripts?: boolean;
  pinnedSessions?: string[];
  /** Files screen: the open tabs and the folders registered under "From disk".
   *  The stores live in `stores/files.ts`; they ride along here because this
   *  file is already read on boot. */
  openFiles?: string[];
  fileSources?: string[];
  keymap?: Partial<Record<Action, Binding>>;
}

/** The three intervals the Pull requests screen offers. */
export const PR_REFRESH_CHOICES: PrRefreshMinutes[] = [1, 3, 10];

const ORDERING_CHOICES: OverviewOrdering[] = ["attention", "workspace", "manual"];

/** Terminal stepper bounds. Below 8 xterm stops being legible; above 24 a
    session pane holds too few columns for Claude Code's TUI to lay out. */
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 24;

async function ensureDir() {
  const dirExists = await exists(SETTINGS_DIR, { baseDir: BaseDirectory.Home });
  if (!dirExists) {
    await mkdir(SETTINGS_DIR, { baseDir: BaseDirectory.Home });
  }
}

/**
 * Every key is optional and every absent key keeps the store's default, so a
 * settings file written by any earlier Atlas still loads.
 */
export async function loadSettings() {
  log.info("settings", "loadSettings started");
  try {
    const fileExists = await exists(SETTINGS_FILE, { baseDir: BaseDirectory.Home });
    log.info("settings", `exists check: ${fileExists}`);
    if (!fileExists) return;
    const raw = await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.Home });
    const data = JSON.parse(raw) as PersistedSettings;
    if (data.enableNotifications === false) enableNotifications.set(false);
    if (Array.isArray(data.watchedRepos)) watchedRepos.set(data.watchedRepos);
    if (data.theme === "system" || data.theme === "light" || data.theme === "dark") {
      themeMode.set(data.theme);
    }
    if (typeof data.soundOnNeedsYou === "boolean") soundOnNeedsYou.set(data.soundOnNeedsYou);
    if (typeof data.terminalFontSize === "number" && data.terminalFontSize > 0) {
      terminalFontSize.set(clampFontSize(data.terminalFontSize));
    }
    if (data.overviewOrdering && ORDERING_CHOICES.includes(data.overviewOrdering)) {
      overviewOrdering.set(data.overviewOrdering);
    }
    if (data.prRefreshMinutes && PR_REFRESH_CHOICES.includes(data.prRefreshMinutes)) {
      prRefreshMinutes.set(data.prRefreshMinutes);
    }
    if (typeof data.autoAddReposFromWorkspaces === "boolean") {
      autoAddReposFromWorkspaces.set(data.autoAddReposFromWorkspaces);
    }
    if (typeof data.tailTranscripts === "boolean") tailTranscripts.set(data.tailTranscripts);
    if (Array.isArray(data.pinnedSessions)) {
      pinnedSessions.set(data.pinnedSessions.filter((id) => typeof id === "string"));
    }
    if (Array.isArray(data.openFiles)) {
      openFiles.set(data.openFiles.filter((key) => typeof key === "string"));
    }
    if (Array.isArray(data.fileSources)) {
      sources.set(data.fileSources.filter((path) => typeof path === "string"));
    }
    // Malformed entries are dropped inside `mergeKeymap`, so a hand-edited file
    // costs the user one binding rather than the whole settings load.
    keymap.set(mergeKeymap(data.keymap));
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
      enableNotifications: get(enableNotifications),
      watchedRepos: get(watchedRepos),
      theme: get(themeMode),
      soundOnNeedsYou: get(soundOnNeedsYou),
      terminalFontSize: get(terminalFontSize),
      overviewOrdering: get(overviewOrdering),
      prRefreshMinutes: get(prRefreshMinutes),
      autoAddReposFromWorkspaces: get(autoAddReposFromWorkspaces),
      tailTranscripts: get(tailTranscripts),
      pinnedSessions: get(pinnedSessions),
      openFiles: get(openFiles),
      fileSources: get(sources),
      keymap: get(keymap),
    };
    await writeTextFile(SETTINGS_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    log.error("settings", "failed to persist settings", e);
    console.error("Failed to persist settings:", e);
  }
}

export function clampFontSize(size: number): number {
  const whole = Math.round(size);
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, whole));
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

export async function setSoundOnNeedsYou(value: boolean) {
  soundOnNeedsYou.set(value);
  await persistSettings();
}

export async function setTerminalFontSize(size: number) {
  terminalFontSize.set(clampFontSize(size));
  await persistSettings();
}

export async function setOverviewOrdering(value: OverviewOrdering) {
  overviewOrdering.set(value);
  await persistSettings();
}

/**
 * Pin or unpin an Overview tile. `overview.pinKey` decides the id, so a pin
 * survives the transcript being adopted and a later resume. Pins for sessions
 * that no longer exist are inert — they simply never match a tile — so nothing
 * has to prune them.
 */
export async function togglePinnedSession(key: string) {
  const current = get(pinnedSessions);
  pinnedSessions.set(
    current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
  );
  await persistSettings();
}

/** Files-screen setters. They live here rather than in `stores/files.ts` so
 *  that only one module writes `~/.atlas/settings.json`. */
export async function setOpenFiles(keys: string[]) {
  openFiles.set(keys);
  await persistSettings();
}

export async function setFileSources(paths: string[]) {
  sources.set(paths);
  await persistSettings();
}

/** Replace the whole keymap — Settings edits it as one draft. */
export async function setKeymap(next: Keymap) {
  keymap.set(next);
  await persistSettings();
}

export async function resetKeymap() {
  keymap.set({ ...DEFAULT_KEYMAP });
  await persistSettings();
}

export async function setPrRefreshMinutes(value: PrRefreshMinutes) {
  prRefreshMinutes.set(value);
  await persistSettings();
}

export async function setAutoAddReposFromWorkspaces(value: boolean) {
  autoAddReposFromWorkspaces.set(value);
  await persistSettings();
}

/**
 * Turning this off has to stop the tails, not just hide the numbers — a tail
 * left running keeps re-reading the transcript and pushing `session-update`.
 * The tracked set is exactly `liveSessions`' keys, which is what
 * `session-update` populates.
 */
export async function setTailTranscripts(value: boolean) {
  tailTranscripts.set(value);
  if (value) {
    // Turning it back on re-arms the sessions that are still running; their
    // `liveSessions` entries survived the pause, so tiles fill back in.
    for (const uuid of runningSessionUuids()) {
      try {
        await startSessionTail(uuid);
      } catch (e) {
        log.warn("settings", `startSessionTail failed for ${uuid}: ${e}`);
      }
    }
  } else {
    for (const uuid of get(liveSessions).keys()) {
      try {
        await stopSessionTail(uuid);
      } catch (e) {
        log.warn("settings", `stopSessionTail failed for ${uuid}: ${e}`);
      }
    }
  }
  await persistSettings();
}

function runningSessionUuids(): string[] {
  const uuids: string[] = [];
  for (const ws of get(workspaces)) {
    for (const session of ws.sessions) {
      if (session.status === "running" && session.claudeSessionId) {
        uuids.push(session.claudeSessionId);
      }
    }
  }
  return uuids;
}
