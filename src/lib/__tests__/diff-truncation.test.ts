import { describe, expect, it } from "vitest";
import { truncationNotice } from "../diff-truncation";
import type { DiffData } from "../../types/panel";

const CUT = { shown_files: 2, total_files: 9, shown_bytes: 2048 };

function diff(over: Partial<DiffData>): DiffData {
  return {
    raw: "",
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
    fingerprint: "f",
    ...over,
  };
}

describe("truncationNotice", () => {
  it("is silent for a diff that was not cut", () => {
    expect(truncationNotice(diff({ raw: "diff --git a/a b/a\n" }), "main")).toBeNull();
    expect(truncationNotice(null, "main")).toBeNull();
  });

  it("says how much of the diff is shown", () => {
    expect(truncationNotice(diff({ truncated: CUT }), "main")).toBe(
      "diff truncated - 2 of 9 files (2.0 KB shown)",
    );
  });

  it("follows the Working tree / vs main toggle, since each side is capped on its own", () => {
    const both = diff({
      raw: "x",
      local_raw: "y",
      truncated: CUT,
      local_truncated: { shown_files: 1, total_files: 1, shown_bytes: 10 },
    });
    expect(truncationNotice(both, "main")).toContain("2 of 9");
    expect(truncationNotice(both, "working")).toContain("1 of 1");
    // No separate working-tree diff: both toggles show `raw`.
    expect(truncationNotice(diff({ raw: "x", truncated: CUT }), "working")).toContain("2 of 9");
  });

  it("adds up a multi-repo panel, counting repos that were not cut in full", () => {
    const multi = diff({
      projects: [
        { name: "api", raw: "abcd", files_changed: 1, lines_added: 0, lines_removed: 0 },
        {
          name: "web",
          raw: "",
          files_changed: 8,
          lines_added: 0,
          lines_removed: 0,
          truncated: { shown_files: 0, total_files: 8, shown_bytes: 0 },
        },
      ],
    });
    expect(truncationNotice(multi, "main")).toBe("diff truncated - 1 of 9 files (4 B shown)");
  });

  it("is silent for a multi-repo panel where no repo was cut", () => {
    const multi = diff({
      projects: [{ name: "api", raw: "abcd", files_changed: 1, lines_added: 0, lines_removed: 0 }],
    });
    expect(truncationNotice(multi, "main")).toBeNull();
  });
});
