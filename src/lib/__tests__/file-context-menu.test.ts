import { describe, expect, it } from "vitest";
import { fileMenuItems } from "../components/files/FileContextMenu";

describe("fileMenuItems", () => {
  it("offers reveal for a row but not for the empty tree", () => {
    const row = fileMenuItems({ inWorkspace: true, isDir: false }, true).map((i) => i.id);
    expect(row).toContain("reveal");
    expect(fileMenuItems(null, true).map((i) => i.id)).not.toContain("reveal");
  });
});
