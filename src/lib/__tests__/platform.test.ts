import { describe, expect, it } from "vitest";
import { chord, enterLabel, isMacPlatform, modLabel } from "../platform";

describe("isMacPlatform", () => {
  it("detects macOS from platform", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "MacARM" })).toBe(true);
  });

  it("detects macOS from user agent", () => {
    expect(
      isMacPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }),
    ).toBe(true);
  });

  it("is false on Windows and Linux", () => {
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(
      isMacPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }),
    ).toBe(false);
    expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false);
  });

  it("falls back to false when there is no navigator", () => {
    expect(isMacPlatform({})).toBe(false);
  });
});

describe("labels", () => {
  it("uses the Command glyph on macOS and Ctrl elsewhere", () => {
    expect(modLabel(true)).toBe("⌘");
    expect(modLabel(false)).toBe("Ctrl+");
  });

  it("builds chords without a stray separator on macOS", () => {
    expect(chord("N", true)).toBe("⌘N");
    expect(chord("N", false)).toBe("Ctrl+N");
    expect(chord(",", true)).toBe("⌘,");
    expect(chord(",", false)).toBe("Ctrl+,");
  });

  it("spells out Enter off macOS", () => {
    expect(enterLabel(true)).toBe("⏎");
    expect(enterLabel(false)).toBe("Enter");
  });
});
