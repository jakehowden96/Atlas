import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../ipc", () => ({
  getApiStatus: vi.fn(),
}));

import {
  panelVisible,
  panelData,
  activeSection,
  apiKeyConfigured,
  togglePanel,
  setSection,
  checkApiStatus,
} from "../stores/panel";
import { getApiStatus } from "../ipc";

describe("panel store", () => {
  beforeEach(() => {
    panelVisible.set(true);
    panelData.set(null);
    activeSection.set("diff");
    apiKeyConfigured.set(false);
    vi.clearAllMocks();
  });

  describe("togglePanel", () => {
    it("toggles from true to false", () => {
      panelVisible.set(true);
      togglePanel();
      expect(get(panelVisible)).toBe(false);
    });

    it("toggles from false to true", () => {
      panelVisible.set(false);
      togglePanel();
      expect(get(panelVisible)).toBe(true);
    });
  });

  describe("setSection", () => {
    it("sets active section to diff", () => {
      setSection("diff");
      expect(get(activeSection)).toBe("diff");
    });

    it("sets active section to summary", () => {
      setSection("summary");
      expect(get(activeSection)).toBe("summary");
    });

    it("sets active section to flow", () => {
      setSection("flow");
      expect(get(activeSection)).toBe("flow");
    });
  });

  describe("checkApiStatus", () => {
    it("sets apiKeyConfigured to true when API returns true", async () => {
      vi.mocked(getApiStatus).mockResolvedValue(true);
      await checkApiStatus();
      expect(get(apiKeyConfigured)).toBe(true);
    });

    it("sets apiKeyConfigured to false when API returns false", async () => {
      vi.mocked(getApiStatus).mockResolvedValue(false);
      await checkApiStatus();
      expect(get(apiKeyConfigured)).toBe(false);
    });
  });
});
