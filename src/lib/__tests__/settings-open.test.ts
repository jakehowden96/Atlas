import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { openSettings, settingsOpen, settingsSection } from "../stores/settings";

describe("openSettings", () => {
  beforeEach(() => {
    settingsOpen.set(false);
    settingsSection.set(null);
  });

  it("opens on a chosen section", () => {
    openSettings("connectors");
    expect(get(settingsOpen)).toBe(true);
    expect(get(settingsSection)).toBe("connectors");
  });

  it("opens without touching the section when none is given", () => {
    openSettings();
    expect(get(settingsOpen)).toBe(true);
    expect(get(settingsSection)).toBeNull();
  });
});
