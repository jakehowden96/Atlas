import namesFile from "../../assets/fonts/icon-names.txt?raw";
import { describe, expect, it } from "vitest";
import { ICONS } from "../components/ui/icon/icon.svelte";

describe("icon glyph list", () => {
  it("matches the list the subset script reads", () => {
    const names = namesFile.split(/\s+/).filter(Boolean);
    expect([...ICONS].sort()).toEqual(names.sort());
    expect(names).toHaveLength(38);
  });
});
