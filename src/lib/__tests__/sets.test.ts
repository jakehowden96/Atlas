import { describe, expect, it } from "vitest";
import { toggled } from "../sets";

describe("toggled", () => {
  it("adds an absent value and removes a present one", () => {
    const empty = new Set<string>();
    const one = toggled(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect([...toggled(one, "a")]).toEqual([]);
  });

  it("leaves the input untouched so $state sees a new reference", () => {
    const before = new Set(["a", "b"]);
    const after = toggled(before, "a");
    expect([...before]).toEqual(["a", "b"]);
    expect(after).not.toBe(before);
    expect([...after]).toEqual(["b"]);
  });
});
