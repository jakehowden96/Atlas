import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

vi.mock("../ipc", () => ({
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
}));

import { DEFAULT_KEYMAP } from "../keymap";
import {
  autoAddReposFromWorkspaces,
  enableNotifications,
  keymap,
  loadSettings,
  overviewOrdering,
  prRefreshMinutes,
  resetKeymap,
  setAutoAddReposFromWorkspaces,
  setEnableNotifications,
  setFileSources,
  setKeymap,
  setOpenFiles,
  setOverviewOrdering,
  setPrRefreshMinutes,
  setSoundOnNeedsYou,
  setTailTranscripts,
  setTerminalFontSize,
  setTheme,
  setWatchedRepos,
  soundOnNeedsYou,
  tailTranscripts,
  terminalFontSize,
  watchedRepos,
} from "../stores/settings";
import { openFiles, sources } from "../stores/files";
import { liveSessions } from "../stores/liveSessions";
import { themeMode } from "../theme";
import { workspaces } from "../stores/workspace";
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { startSessionTail, stopSessionTail } from "../ipc";

/** The persisted object the last `writeTextFile` call wrote. */
function lastWritten() {
  const calls = vi.mocked(writeTextFile).mock.calls;
  return JSON.parse(calls[calls.length - 1][1] as string);
}

function allowWrites() {
  vi.mocked(exists).mockResolvedValue(true);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(writeTextFile).mockResolvedValue(undefined);
}

describe("settings store", () => {
  beforeEach(() => {
    // Reset to defaults
    enableNotifications.set(true);
    watchedRepos.set([]);
    themeMode.set("system");
    soundOnNeedsYou.set(false);
    terminalFontSize.set(13);
    overviewOrdering.set("attention");
    prRefreshMinutes.set(3);
    autoAddReposFromWorkspaces.set(false);
    tailTranscripts.set(true);
    liveSessions.set(new Map());
    workspaces.set([]);
    openFiles.set([]);
    sources.set([]);
    keymap.set({ ...DEFAULT_KEYMAP });
    vi.clearAllMocks();
  });

  describe("loadSettings", () => {
    it("loads enableNotifications false from file", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ enableNotifications: false }),
      );
      await loadSettings();
      expect(get(enableNotifications)).toBe(false);
    });

    it("handles missing file gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      await loadSettings();
      expect(get(enableNotifications)).toBe(true);
    });

    it("handles corrupted JSON gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("{not valid json");
      await loadSettings();
      expect(get(enableNotifications)).toBe(true);
    });

    /** The 4.x on-disk shape. Every key added since must fall back to a default. */
    it("loads an old three-key settings file and fills in defaults", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          // `skipPermissions` was removed in 5.0; an old file still carries it
          // and must load without error rather than throwing on an unknown key.
          skipPermissions: true,
          enableNotifications: false,
          watchedRepos: ["owner/repo"],
        }),
      );
      await loadSettings();

      expect(get(enableNotifications)).toBe(false);
      expect(get(watchedRepos)).toEqual(["owner/repo"]);
      // Absent keys keep their defaults rather than becoming undefined.
      expect(get(themeMode)).toBe("system");
      expect(get(soundOnNeedsYou)).toBe(false);
      expect(get(terminalFontSize)).toBe(13);
      expect(get(overviewOrdering)).toBe("attention");
      expect(get(prRefreshMinutes)).toBe(3);
      expect(get(autoAddReposFromWorkspaces)).toBe(false);
      expect(get(tailTranscripts)).toBe(true);
    });

    it("loads every new key when the file carries them", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          theme: "dark",
          soundOnNeedsYou: true,
          terminalFontSize: 15,
          overviewOrdering: "workspace",
          prRefreshMinutes: 10,
          autoAddReposFromWorkspaces: true,
          tailTranscripts: false,
        }),
      );
      await loadSettings();

      expect(get(themeMode)).toBe("dark");
      expect(get(soundOnNeedsYou)).toBe(true);
      expect(get(terminalFontSize)).toBe(15);
      expect(get(overviewOrdering)).toBe("workspace");
      expect(get(prRefreshMinutes)).toBe(10);
      expect(get(autoAddReposFromWorkspaces)).toBe(true);
      expect(get(tailTranscripts)).toBe(false);
    });

    it("ignores out-of-range values rather than adopting them", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          prRefreshMinutes: 7,
          overviewOrdering: "alphabetical",
          theme: "solarized",
        }),
      );
      await loadSettings();

      expect(get(prRefreshMinutes)).toBe(3);
      expect(get(overviewOrdering)).toBe("attention");
      expect(get(themeMode)).toBe("system");
    });

    it("clamps an absurd persisted font size", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ terminalFontSize: 400 }));
      await loadSettings();
      expect(get(terminalFontSize)).toBe(24);
    });

    it("merges a partial persisted keymap over the defaults", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ keymap: { jump: { mod: true, shift: false, key: "p" } } }),
      );
      await loadSettings();

      expect(get(keymap).jump).toEqual({ mod: true, shift: false, key: "p" });
      expect(get(keymap).newSession).toEqual(DEFAULT_KEYMAP.newSession);
    });

    it("drops a malformed binding rather than throwing", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ keymap: { jump: "⌘P", settings: { mod: true, shift: false, key: "e" } } }),
      );
      await loadSettings();

      expect(get(keymap).jump).toEqual(DEFAULT_KEYMAP.jump);
      expect(get(keymap).settings).toEqual({ mod: true, shift: false, key: "e" });
    });

    it("a settings file from an earlier Atlas keeps every default chord", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ theme: "dark" }));
      await loadSettings();
      expect(get(keymap)).toEqual(DEFAULT_KEYMAP);
    });
  });

  describe("the keymap setters", () => {
    it("setKeymap persists the whole map and resetKeymap puts it back", async () => {
      allowWrites();
      const next = { ...DEFAULT_KEYMAP, jump: { mod: true, shift: false, key: "p" } };
      await setKeymap(next);
      expect(get(keymap).jump).toEqual({ mod: true, shift: false, key: "p" });
      expect(lastWritten().keymap.jump).toEqual({ mod: true, shift: false, key: "p" });

      await resetKeymap();
      expect(get(keymap)).toEqual(DEFAULT_KEYMAP);
      expect(lastWritten().keymap).toEqual(DEFAULT_KEYMAP);
    });
  });

  describe("setEnableNotifications", () => {
    it("updates store value and persists", async () => {
      allowWrites();
      await setEnableNotifications(false);
      expect(get(enableNotifications)).toBe(false);
      expect(writeTextFile).toHaveBeenCalled();
    });
  });

  describe("watchedRepos", () => {
    it("loads watchedRepos from file", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ watchedRepos: ["owner/repo-a", "owner/repo-b"] }),
      );
      await loadSettings();
      expect(get(watchedRepos)).toEqual(["owner/repo-a", "owner/repo-b"]);
    });

    it("ignores non-array watchedRepos in file", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ watchedRepos: "not-an-array" }),
      );
      await loadSettings();
      expect(get(watchedRepos)).toEqual([]);
    });

    it("setWatchedRepos updates store and persists", async () => {
      allowWrites();
      await setWatchedRepos(["owner/repo"]);
      expect(get(watchedRepos)).toEqual(["owner/repo"]);
      expect(writeTextFile).toHaveBeenCalled();
      expect(lastWritten().watchedRepos).toEqual(["owner/repo"]);
    });
  });

  describe("the setters added in 2.0.0", () => {
    it("persists the theme", async () => {
      allowWrites();
      await setTheme("dark");
      expect(get(themeMode)).toBe("dark");
      expect(lastWritten().theme).toBe("dark");
    });

    it("persists sound on needs-you", async () => {
      allowWrites();
      await setSoundOnNeedsYou(true);
      expect(lastWritten().soundOnNeedsYou).toBe(true);
    });

    it("persists the terminal font size, clamped", async () => {
      allowWrites();
      await setTerminalFontSize(14);
      expect(get(terminalFontSize)).toBe(14);
      expect(lastWritten().terminalFontSize).toBe(14);

      await setTerminalFontSize(1);
      expect(get(terminalFontSize)).toBe(8);
    });

    it("rounds fractional sizes to whole pixels", async () => {
      allowWrites();
      // xterm derives cell metrics from the font size; a fractional value
      // rounds unevenly across rows and misaligns box-drawing glyphs.
      await setTerminalFontSize(12.5);
      expect(get(terminalFontSize)).toBe(13);
      await setTerminalFontSize(13.4);
      expect(get(terminalFontSize)).toBe(13);
    });

    it("persists the overview ordering", async () => {
      allowWrites();
      await setOverviewOrdering("manual");
      expect(lastWritten().overviewOrdering).toBe("manual");
    });

    it("persists the PR refresh interval", async () => {
      allowWrites();
      await setPrRefreshMinutes(10);
      expect(get(prRefreshMinutes)).toBe(10);
      expect(lastWritten().prRefreshMinutes).toBe(10);
    });

    it("persists auto-add repos", async () => {
      allowWrites();
      await setAutoAddReposFromWorkspaces(true);
      expect(lastWritten().autoAddReposFromWorkspaces).toBe(true);
    });
  });

  /** The Files screen's two persisted stores live in `stores/files.ts` but ride
   *  along in this file, so the round trip crosses both modules. */
  describe("the Files screen's state", () => {
    it("persists the open tabs and the disk sources", async () => {
      allowWrites();
      await setOpenFiles(["wsdocs/guide.md"]);
      await setFileSources(["/home/me/notes"]);

      expect(get(openFiles)).toEqual(["wsdocs/guide.md"]);
      expect(get(sources)).toEqual(["/home/me/notes"]);
      expect(lastWritten().openFiles).toEqual(["wsdocs/guide.md"]);
      expect(lastWritten().fileSources).toEqual(["/home/me/notes"]);
    });

    it("loads them back, ignoring malformed entries", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          openFiles: ["wsnote.md", 7],
          fileSources: ["/home/me/notes", null],
        }),
      );
      await loadSettings();

      expect(get(openFiles)).toEqual(["wsnote.md"]);
      expect(get(sources)).toEqual(["/home/me/notes"]);
    });
  });

  describe("setTailTranscripts", () => {
    it("stops the tail of every tracked session when turned off", async () => {
      allowWrites();
      liveSessions.set(
        new Map([
          ["uuid-a", { sessionUuid: "uuid-a" }],
          ["uuid-b", { sessionUuid: "uuid-b" }],
        ] as never),
      );

      await setTailTranscripts(false);

      expect(get(tailTranscripts)).toBe(false);
      expect(stopSessionTail).toHaveBeenCalledTimes(2);
      expect(stopSessionTail).toHaveBeenCalledWith("uuid-a");
      expect(stopSessionTail).toHaveBeenCalledWith("uuid-b");
      expect(lastWritten().tailTranscripts).toBe(false);
    });

    it("keeps the live session entries so tiles degrade rather than vanish", async () => {
      allowWrites();
      liveSessions.set(new Map([["uuid-a", { sessionUuid: "uuid-a" }]] as never));
      await setTailTranscripts(false);
      expect(get(liveSessions).size).toBe(1);
    });

    it("survives a rejecting stop_session_tail", async () => {
      allowWrites();
      vi.mocked(stopSessionTail).mockRejectedValue(new Error("no such tail"));
      liveSessions.set(new Map([["uuid-a", { sessionUuid: "uuid-a" }]] as never));
      await expect(setTailTranscripts(false)).resolves.toBeUndefined();
      expect(get(tailTranscripts)).toBe(false);
    });

    it("re-arms the running sessions when turned back on", async () => {
      allowWrites();
      workspaces.set([
        {
          path: "/a",
          name: "a",
          sessions: [
            {
              id: "s1",
              label: "S1",
              status: "running",
              terminalTabId: "tab-1",
              createdAt: "",
              claudeSessionId: "uuid-a",
            },
            {
              id: "s2",
              label: "S2",
              status: "idle",
              terminalTabId: null,
              createdAt: "",
              claudeSessionId: "uuid-b",
            },
          ],
        },
      ]);

      await setTailTranscripts(true);

      expect(startSessionTail).toHaveBeenCalledTimes(1);
      expect(startSessionTail).toHaveBeenCalledWith("uuid-a");
    });
  });
});
