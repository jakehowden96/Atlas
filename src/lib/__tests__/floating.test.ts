import { describe, expect, it } from "vitest";
import { computePosition } from "../ui/floating";

const viewport = { width: 400, height: 300 };
const size = { width: 100, height: 30 };

describe("computePosition", () => {
  it("centres on the preferred side", () => {
    const r = computePosition({ anchor: { left: 150, top: 150, width: 100, height: 20 }, size, viewport, side: "top" });
    expect(r).toEqual({ x: 150, y: 150 - 30 - 6, side: "top" });
  });

  it("flips to bottom when top overflows", () => {
    const r = computePosition({ anchor: { left: 150, top: 10, width: 100, height: 20 }, size, viewport, side: "top" });
    expect(r.side).toBe("bottom");
    expect(r.y).toBe(10 + 20 + 6);
  });

  it("flips left to right near the left edge", () => {
    const r = computePosition({ anchor: { left: 10, top: 100, width: 20, height: 20 }, size, viewport, side: "left" });
    expect(r.side).toBe("right");
  });

  it("keeps the preferred side when it fits", () => {
    const r = computePosition({ anchor: { left: 150, top: 60, width: 20, height: 190 }, size, viewport, side: "top" });
    expect(r.side).toBe("top");
  });

  it("clamps the cross axis inside the viewport", () => {
    const r = computePosition({ anchor: { left: 380, top: 150, width: 10, height: 10 }, size, viewport, side: "top" });
    expect(r.x).toBe(400 - 100 - 8);
  });
});
