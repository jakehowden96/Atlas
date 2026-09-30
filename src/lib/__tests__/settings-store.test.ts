import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  startOmpTail: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
}));

vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { DEFAULT_KEYMAP } from "../keymap";
import {
  autoAddReposFromWorkspaces,
  DEFAULT_HARNESSES,
  enableNotifications,
  harnesses,
  keymap,
  lastHarnessId,
  loadSettings,
  migrateSettings,
  overviewOrdering,
  prRefreshMinutes,
  resetKeymap,
  setAutoAddReposFromWorkspaces,
  setEnableNotifications,
  setFileSources,
  setHarnesses,
  setKeymap,
  setLastHarnessId,
  setOpenFiles,
  setOverviewOrdering,
  setPrRefreshMinutes,
  setSoundOnNeedsYou,
  setTailTranscripts,
  setTerminalFontSize,
  setTheme,
  setWatchedRepos,
  SETTINGS_VERSION,
  soundOnNeedsYou,
  tailTranscripts,
  terminalFontSize,
  transcriptKind,
  watchedRepos,
  type HarnessConfig,
} from "../stores/settings";
import { openFiles, sources } from "../stores/file-tabs";
import { liveSessions } from "../stores/liveSessions";
import { tabs } from "../stores/terminal";
import { themeMode } from "../theme";
import { workspaces } from "../stores/workspace";
import { toasts } from "../stores/toast";
import { startOmpTail, startSessionTail, stopSessionTail, stateLoad, stateSave } from "../ipc";

/** The persisted object the last `stateSave` call wrote. */
function lastWritten() {
  const calls = vi.mocked(stateSave).mock.calls;
  return JSON.parse(calls[calls.length - 1][1] as string);
}

/** What the backend hands `loadSettings` for a file that exists. */
function mockFile(contents: string) {
  vi.mocked(stateLoad).mockResolvedValue({ contents, recovered: false });
}

function mockNoFile() {
  vi.mocked(stateLoad).mockResolvedValue({ contents: null, recovered: false });
}

function allowWrites() {
  vi.mocked(stateSave).mockResolvedValue(undefined);
}

describe("settings store", () => {
  // Writes are held until the first load settles, so settle it once.
  beforeAll(async () => {
    mockNoFile();
    await loadSettings();
  });

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
    harnesses.set([...DEFAULT_HARNESSES]);
    lastHarnessId.set("claude-code");
    liveSessions.set(new Map());
    workspaces.set([]);
    tabs.set([]);
    openFiles.set([]);
    sources.set([]);
    keymap.set({ ...DEFAULT_KEYMAP });
    vi.clearAllMocks();
  });

  describe("loadSettings", () => {
    it("loads enableNotifications false from file", async () => {
      mockFile(JSON.stringify({ enableNotifications: false }));
      await loadSettings();
      expect(get(enableNotifications)).toBe(false);
    });

    it("handles missing file gracefully", async () => {
      mockNoFile();
      await loadSettings();
      expect(get(enableNotifications)).toBe(true);
    });

    it("tells the user when the settings file cannot be read", async () => {
      toasts.set([]);
      vi.mocked(stateLoad).mockRejectedValueOnce(new Error("permission denied"));
      await loadSettings();
      expect(get(toasts).map((t) => t.title)).toEqual(["Could not read your settings"]);
      expect(get(enableNotifications)).toBe(true);
    });

    it("tells the user once where the backup went when the file was unusable", async () => {
      toasts.set([]);
      vi.mocked(stateLoad).mockResolvedValue({ contents: null, recovered: true });
      await loadSettings();
      await loadSettings();
      const recovered = get(toasts).filter(
        (t) => t.title === "Your settings file could not be read",
      );
      expect(recovered).toHaveLength(1);
      expect(recovered[0].body).toContain("settings.json.bak");
      expect(get(enableNotifications)).toBe(true);
    });

    it("loads what it understands from a file written by a newer version and says so", async () => {
      toasts.set([]);
      mockFile(JSON.stringify({ version: SETTINGS_VERSION + 1, theme: "dark", futureKey: 1 }));
      await loadSettings();
      expect(get(themeMode)).toBe("dark");
      expect(get(toasts).map((t) => t.title)).toContain(
        "Your settings were saved by a newer Atlas",
      );
    });

    /** The 4.x on-disk shape. Every key added since must fall back to a default. */
    it("loads an old three-key settings file and fills in defaults", async () => {
      mockFile(
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
      mockFile(
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
      mockFile(
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
      mockFile(JSON.stringify({ terminalFontSize: 400 }));
      await loadSettings();
      expect(get(terminalFontSize)).toBe(24);
    });

    it("merges a partial persisted keymap over the defaults", async () => {
      mockFile(JSON.stringify({ keymap: { jump: { mod: true, shift: false, key: "p" } } }));
      await loadSettings();

      // A file written before alternates existed holds one binding per action;
      // it loads as that action's only chord.
      expect(get(keymap).jump).toEqual([{ mod: true, shift: false, key: "p" }]);
      expect(get(keymap).newSession).toEqual(DEFAULT_KEYMAP.newSession);
    });

    it("drops a malformed binding rather than throwing", async () => {
      mockFile(
        JSON.stringify({ keymap: { jump: "⌘P", settings: { mod: true, shift: false, key: "e" } } }),
      );
      await loadSettings();

      expect(get(keymap).jump).toEqual(DEFAULT_KEYMAP.jump);
      expect(get(keymap).settings).toEqual([{ mod: true, shift: false, key: "e" }]);
    });

    it("a settings file from an earlier Atlas keeps every default chord", async () => {
      mockFile(JSON.stringify({ theme: "dark" }));
      await loadSettings();
      expect(get(keymap)).toEqual(DEFAULT_KEYMAP);
    });
  });

  describe("harnesses", () => {
    const customHarness: HarnessConfig = {
      id: "omp",
      label: "omp",
      command: "omp",
      args: [],
      resumable: false,
      readyMode: "immediate",
    };

    it("loads a valid harnesses list from file", async () => {
      mockFile(JSON.stringify({ harnesses: [customHarness], lastHarnessId: "omp" }));
      await loadSettings();
      expect(get(harnesses)).toEqual([customHarness]);
      expect(get(lastHarnessId)).toBe("omp");
    });

    it("drops a malformed entry, keeping the defaults if that empties the list", async () => {
      mockFile(JSON.stringify({ harnesses: [{ id: "bad" }] }));
      await loadSettings();
      expect(get(harnesses)).toEqual(DEFAULT_HARNESSES);
    });

    it("drops harnesses with an empty or repeated id", async () => {
      mockFile(
        JSON.stringify({
          harnesses: [
            { ...customHarness, id: "" },
            customHarness,
            { ...customHarness, label: "dup" },
          ],
        }),
      );
      await loadSettings();
      expect(get(harnesses)).toEqual([customHarness]);
    });

    it("keeps the defaults when the file has no harnesses key at all", async () => {
      mockFile(JSON.stringify({ theme: "dark" }));
      await loadSettings();
      expect(get(harnesses)).toEqual(DEFAULT_HARNESSES);
      expect(get(lastHarnessId)).toBe("claude-code");
    });

    it("setHarnesses and setLastHarnessId persist and round-trip", async () => {
      allowWrites();
      await setHarnesses([...DEFAULT_HARNESSES, customHarness]);
      await setLastHarnessId("omp");
      expect(get(harnesses)).toEqual([...DEFAULT_HARNESSES, customHarness]);
      expect(get(lastHarnessId)).toBe("omp");
      expect(lastWritten().harnesses).toEqual([...DEFAULT_HARNESSES, customHarness]);
      expect(lastWritten().lastHarnessId).toBe("omp");
    });
  });

  describe("transcriptKind", () => {
    it("classifies each default harness", () => {
      expect(transcriptKind(DEFAULT_HARNESSES[0])).toBe("claude"); // claude-code
      expect(transcriptKind(DEFAULT_HARNESSES[1])).toBe("omp"); // omp
      expect(transcriptKind(DEFAULT_HARNESSES[2])).toBeNull(); // terminal
    });

    it("classifies a custom omp-shaped harness by command, not id", () => {
      const custom: HarnessConfig = {
        id: "my-omp",
        label: "My OMP",
        command: "omp",
        args: [],
        resumable: false,
        readyMode: "immediate",
      };
      expect(transcriptKind(custom)).toBe("omp");
    });
  });

  describe("the keymap setters", () => {
    it("setKeymap persists the whole map and resetKeymap puts it back", async () => {
      allowWrites();
      const next = { ...DEFAULT_KEYMAP, jump: [{ mod: true, shift: false, key: "p" }] };
      await setKeymap(next);
      expect(get(keymap).jump).toEqual([{ mod: true, shift: false, key: "p" }]);
      expect(lastWritten().keymap.jump).toEqual([{ mod: true, shift: false, key: "p" }]);

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
      expect(stateSave).toHaveBeenCalled();
    });
  });

  describe("watchedRepos", () => {
    it("loads watchedRepos from file", async () => {
      mockFile(JSON.stringify({ watchedRepos: ["owner/repo-a", "owner/repo-b"] }));
      await loadSettings();
      expect(get(watchedRepos)).toEqual(["owner/repo-a", "owner/repo-b"]);
    });

    it("keeps only string entries of watchedRepos", async () => {
      mockFile(JSON.stringify({ watchedRepos: ["owner/repo", 1, {}, null] }));
      await loadSettings();
      expect(get(watchedRepos)).toEqual(["owner/repo"]);
    });

    it("ignores non-array watchedRepos in file", async () => {
      mockFile(JSON.stringify({ watchedRepos: "not-an-array" }));
      await loadSettings();
      expect(get(watchedRepos)).toEqual([]);
    });

    it("setWatchedRepos updates store and persists", async () => {
      allowWrites();
      await setWatchedRepos(["owner/repo"]);
      expect(get(watchedRepos)).toEqual(["owner/repo"]);
      expect(stateSave).toHaveBeenCalled();
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
      mockFile(
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

    it("also stops a tail that has started but not emitted yet", async () => {
      allowWrites();
      liveSessions.set(new Map());
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
              claudeSessionId: "uuid-fresh",
              harnessId: null,
            },
          ],
        },
      ]);

      await setTailTranscripts(false);

      expect(stopSessionTail).toHaveBeenCalledWith("uuid-fresh");
    });

    it("saves the setting before waiting on the stops", async () => {
      allowWrites();
      let release!: () => void;
      vi.mocked(stopSessionTail).mockReturnValue(new Promise<void>((r) => (release = r)));
      liveSessions.set(new Map([["uuid-a", { sessionUuid: "uuid-a" }]] as never));

      const pending = setTailTranscripts(false);
      await vi.waitFor(() => expect(lastWritten().tailTranscripts).toBe(false));
      release();
      await pending;
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
              harnessId: null,
            },
            {
              id: "s2",
              label: "S2",
              status: "idle",
              terminalTabId: null,
              createdAt: "",
              claudeSessionId: "uuid-b",
              harnessId: null,
            },
          ],
        },
      ]);

      await setTailTranscripts(true);

      expect(startSessionTail).toHaveBeenCalledTimes(1);
      expect(startSessionTail).toHaveBeenCalledWith("uuid-a");
    });

    it("re-arms an omp session with its tab's pty id", async () => {
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
              harnessId: "omp",
            },
          ],
        },
      ]);
      tabs.set([{ id: "tab-1", ptyId: 7 }] as never);

      await setTailTranscripts(true);

      expect(startOmpTail).toHaveBeenCalledWith("uuid-a", 7);
      expect(startSessionTail).not.toHaveBeenCalled();
    });
  });
});

describe("migrateSettings", () => {
  it("treats a file with no version as version 0 and not newer", () => {
    const { data, newerThanKnown } = migrateSettings({ theme: "dark" });
    expect(data.theme).toBe("dark");
    expect(newerThanKnown).toBe(false);
  });

  it("flags only a version above the one this build writes", () => {
    expect(migrateSettings({ version: SETTINGS_VERSION }).newerThanKnown).toBe(false);
    expect(migrateSettings({ version: SETTINGS_VERSION + 1 }).newerThanKnown).toBe(true);
  });

  it.each([null, "text", 3, [1, 2]])("reads %j as an empty settings file", (raw) => {
    expect(migrateSettings(raw)).toEqual({ data: {}, newerThanKnown: false });
  });
});

describe("settings persistence", () => {
  it("writes the schema version with every save", async () => {
    allowWrites();
    await setTheme("dark");
    expect(lastWritten().version).toBe(SETTINGS_VERSION);
  });
});
