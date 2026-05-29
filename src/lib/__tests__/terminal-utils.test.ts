import { describe, it, expect } from "vitest";
import { panelDataChanged, parseOsc7Cwd } from "../terminal-utils";
import type { PanelData } from "../../types/panel";

function makePanel(overrides: Partial<PanelData> = {}): PanelData {
  return {
    version: 1,
    timestamp: "2024-01-01T00:00:00Z",
    cwd: "/tmp",
    is_git: true,
    diff: undefined,
    plan: undefined,
    ...overrides,
  };
}

describe("panelDataChanged", () => {
  it("returns false for null data when lastVersion is -1", () => {
    expect(panelDataChanged(null, -1, null)).toBe(false);
  });

  it("returns true for null data when lastVersion is 0", () => {
    expect(panelDataChanged(null, 0, null)).toBe(true);
  });

  it("returns true when version changes", () => {
    const data = makePanel({ version: 2 });
    expect(panelDataChanged(data, 1, null)).toBe(true);
  });

  it("returns true when diff raw changes", () => {
    const data = makePanel({ diff: { raw: "new diff", files_changed: 1, lines_added: 1, lines_removed: 0 } });
    expect(panelDataChanged(data, 1, "old diff")).toBe(true);
  });

  it("returns false when neither version nor diff changes", () => {
    const data = makePanel({ version: 1, diff: { raw: "same", files_changed: 1, lines_added: 1, lines_removed: 0 } });
    expect(panelDataChanged(data, 1, "same")).toBe(false);
  });

  it("returns false when data has no diff and lastDiffRaw is null", () => {
    const data = makePanel({ version: 1 });
    expect(panelDataChanged(data, 1, null)).toBe(false);
  });
});

describe("parseOsc7Cwd", () => {
  it("parses file:// URL correctly", () => {
    expect(parseOsc7Cwd("file://hostname/Users/test/project")).toBe("/Users/test/project");
  });

  it("handles URL with encoded characters", () => {
    expect(parseOsc7Cwd("file://host/path/with%20spaces")).toBe("/path/with spaces");
  });

  it("handles raw path string (no URL)", () => {
    expect(parseOsc7Cwd("/Users/test/project")).toBe("/Users/test/project");
  });

  it("returns null for empty string", () => {
    expect(parseOsc7Cwd("")).toBe(null);
  });

  it("trims whitespace from raw path", () => {
    expect(parseOsc7Cwd("  /Users/test  ")).toBe("/Users/test");
  });
});
