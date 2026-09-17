import { describe, expect, it } from "vitest";
import { basename, formatAgo, formatBytes, formatTokens } from "../format";

describe("basename", () => {
  it("takes the last segment of a path on either separator", () => {
    expect(basename("C:\\Users\\jakeh\\Documents\\GitHub\\Atlas")).toBe("Atlas");
    expect(basename("/home/j/repos/atlas/")).toBe("atlas");
    expect(basename("atlas")).toBe("atlas");
  });
});

describe("formatAgo", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const ago = (iso: string, minUnit?: "second" | "minute") =>
    formatAgo(Date.parse(iso), now, minUnit);

  it("counts the first minute only when asked for seconds", () => {
    expect(ago("2026-09-08T11:59:48Z", "second")).toBe("12s ago");
    expect(ago("2026-09-08T11:59:48Z")).toBe("just now");
  });

  it("climbs the ladder from minutes to years", () => {
    expect(ago("2026-09-08T11:30:00Z")).toBe("30m ago");
    expect(ago("2026-09-08T08:00:00Z")).toBe("4h ago");
    expect(ago("2026-09-05T12:00:00Z")).toBe("3d ago");
    expect(ago("2026-07-08T12:00:00Z")).toBe("2mo ago");
    expect(ago("2024-09-08T12:00:00Z")).toBe("2y ago");
  });

  it("never counts forwards", () => {
    expect(ago("2026-09-08T12:05:00Z", "second")).toBe("0s ago");
  });
});

describe("formatTokens", () => {
  it("counts plainly below a thousand", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(340)).toBe("340");
    expect(formatTokens(999)).toBe("999");
  });

  it("keeps a decimal under ten thousand, drops it above", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(9400)).toBe("9.4k");
    expect(formatTokens(12_500)).toBe("13k");
    expect(formatTokens(68_000)).toBe("68k");
  });
});

describe("formatBytes", () => {
  it("counts bytes, then KB, then MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(4300)).toBe("4.2 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3 * 1024 * 1024 + 512 * 1024)).toBe("3.5 MB");
  });
});
