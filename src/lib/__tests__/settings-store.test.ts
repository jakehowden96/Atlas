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
  skipPermissions,
  enableNotifications,
  loadSettings,
  setSkipPermissions,
  setEnableNotifications,
} from "../stores/settings";
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";

describe("settings store", () => {
  beforeEach(() => {
    // Reset to defaults
    skipPermissions.set(false);
    enableNotifications.set(true);
    vi.clearAllMocks();
  });

  describe("loadSettings", () => {
    it("loads skipPermissions from file", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ skipPermissions: true, enableNotifications: true }),
      );
      await loadSettings();
      expect(get(skipPermissions)).toBe(true);
    });

    it("loads enableNotifications false from file", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ skipPermissions: false, enableNotifications: false }),
      );
      await loadSettings();
      expect(get(enableNotifications)).toBe(false);
    });

    it("handles missing file gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      await loadSettings();
      expect(get(skipPermissions)).toBe(false);
      expect(get(enableNotifications)).toBe(true);
    });

    it("handles corrupted JSON gracefully", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("{not valid json");
      await loadSettings();
      expect(get(skipPermissions)).toBe(false);
    });
  });

  describe("setSkipPermissions", () => {
    it("updates store value and persists", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeTextFile).mockResolvedValue(undefined);
      await setSkipPermissions(true);
      expect(get(skipPermissions)).toBe(true);
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
