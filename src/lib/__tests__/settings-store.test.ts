import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { Home: 0 },
}));

import {
  enableNotifications,
  selectedTool,
  toolSettings,
  loadSettings,
  setToolSetting,
  setEnableNotifications,
  setSelectedTool,
} from "../stores/settings";
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";

describe("settings store", () => {
  beforeEach(() => {
    selectedTool.set("claude-code");
    toolSettings.set({});
    enableNotifications.set(true);
    vi.clearAllMocks();
  });

  describe("loadSettings", () => {
    it("migrates old skipPermissions into toolSettings", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ skipPermissions: true, enableNotifications: true }),
      );
      await loadSettings();
      expect(get(toolSettings)["claude-code"]?.skipPermissions).toBe(true);
    });

    it("loads new format toolSettings", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          selectedTool: "codex",
          enableNotifications: false,
          toolSettings: { codex: { approvalMode: "never" } },
        }),
      );
      await loadSettings();
      expect(get(selectedTool)).toBe("codex");
      expect(get(enableNotifications)).toBe(false);
      expect(get(toolSettings).codex?.approvalMode).toBe("never");
    });

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
      expect(get(toolSettings)).toEqual({});
      expect(get(enableNotifications)).toBe(true);
    });

    it("handles corrupted JSON gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("{not valid json");
      await loadSettings();
      expect(get(toolSettings)).toEqual({});
    });
  });

  describe("setToolSetting", () => {
    it("updates tool setting and persists", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeTextFile).mockResolvedValue(undefined);
      await setToolSetting("claude-code", "skipPermissions", true);
      expect(get(toolSettings)["claude-code"]?.skipPermissions).toBe(true);
      expect(writeTextFile).toHaveBeenCalled();
    });
  });

  describe("setSelectedTool", () => {
    it("updates selected tool and persists", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeTextFile).mockResolvedValue(undefined);
      await setSelectedTool("codex");
      expect(get(selectedTool)).toBe("codex");
      expect(writeTextFile).toHaveBeenCalled();
    });
  });

  describe("setEnableNotifications", () => {
    it("updates store value and persists", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeTextFile).mockResolvedValue(undefined);
      await setEnableNotifications(false);
      expect(get(enableNotifications)).toBe(false);
      expect(writeTextFile).toHaveBeenCalled();
    });
  });
});
