export type SectionId =
  | "general"
  | "keyboard"
  | "workspaces"
  | "connectors"
  | "harnesses"
  | "claude"
  | "about";

export interface SettingEntry {
  section: SectionId;
  title: string;
  description: string;
  keywords: string[];
}

/** Every setting row. Keep in step with the sections; settings-search.test.ts fails when a row title is missing. */
export const SETTINGS_INDEX: SettingEntry[] = [
  { section: "general", title: "Appearance", description: "Follows the OS unless you pin one", keywords: ["theme", "dark", "light", "colour", "color"] },
  { section: "general", title: "System notifications", description: "Notify when a session needs you and Atlas isn't focused", keywords: ["alerts", "notify"] },
  { section: "general", title: "Sound on needs-you", description: "A short ping when a permission prompt appears", keywords: ["audio", "ping", "beep"] },
  { section: "general", title: "Terminal font size", description: "Applies to all sessions", keywords: ["text", "zoom", "xterm"] },
  { section: "general", title: "Sessions ordering", description: "Needs-you first, then running, then idle", keywords: ["sort", "overview", "order"] },
  { section: "keyboard", title: "Reset all shortcuts", description: "Restore the default keyboard shortcuts", keywords: ["keybindings", "chords", "hotkeys", "default"] },
  { section: "keyboard", title: "Shortcuts", description: "Rebind the global keyboard shortcuts", keywords: ["keybindings", "chords", "hotkeys", "keys"] },
  { section: "workspaces", title: "Language servers", description: "Run a language server per workspace for diagnostics in Files", keywords: ["lsp", "trust", "typescript", "rust"] },
  { section: "connectors", title: "Auto-add repos from workspaces", description: "Watch every workspace's GitHub remote", keywords: ["github", "pull requests", "remote"] },
  { section: "connectors", title: "Refresh interval", description: "How often pull requests are re-polled", keywords: ["poll", "minutes", "github"] },
  { section: "harnesses", title: "Harnesses", description: "The commands New Session can launch", keywords: ["command", "args", "terminal", "agent"] },
  { section: "claude", title: "Install hooks", description: "Flags sessions that need you and follows /clear and /compact", keywords: ["notification", "sessionstart", "settings.json"] },
  { section: "claude", title: "Tail transcripts", description: "Shows context, tokens, cost and subagents on each session", keywords: ["jsonl", "cost", "tokens", "live"] },
  { section: "claude", title: "Claude binary", description: "Which claude executable Atlas launches", keywords: ["path", "cli", "executable", "version"] },
  { section: "about", title: "Updates", description: "Check for a new version of Atlas", keywords: ["upgrade", "release", "install", "relaunch"] },
  { section: "about", title: "Check automatically", description: "Look for updates every hour", keywords: ["auto", "background", "updates"] },
  { section: "about", title: "Copy diagnostics", description: "Version, OS and Claude version for a bug report", keywords: ["bug", "support", "debug", "info"] },
];

function score(e: SettingEntry, q: string): number {
  const title = e.title.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (title.includes(q)) return 60;
  if (e.keywords.some((k) => k.toLowerCase().includes(q))) return 40;
  if (e.description.toLowerCase().includes(q)) return 20;
  return 0;
}

/** Entries matching every word of `query`, best first; ties keep index order. */
export function searchSettings(
  query: string,
  index: SettingEntry[] = SETTINGS_INDEX,
): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return index
    .map((e, i) => {
      const scores = words.map((w) => score(e, w));
      return { e, i, s: scores.every((n) => n > 0) ? scores.reduce((a, b) => a + b, 0) : 0 };
    })
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.e);
}
