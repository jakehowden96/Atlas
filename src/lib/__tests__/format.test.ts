import { describe, expect, it } from "vitest";
import { basename, formatAgo } from "../format";

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
