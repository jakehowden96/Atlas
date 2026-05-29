import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";

import { panelVisible, panelData, togglePanel } from "../stores/panel";

describe("panel store", () => {
  beforeEach(() => {
    panelVisible.set(true);
    panelData.set(null);
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
});
