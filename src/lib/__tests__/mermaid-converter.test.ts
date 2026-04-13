import { describe, it, expect } from "vitest";
import { flowEdgesToMermaid } from "../mermaid-converter";

describe("flowEdgesToMermaid", () => {
  it("returns placeholder for empty edges", () => {
    const result = flowEdgesToMermaid([]);
    expect(result).toContain("graph LR");
    expect(result).toContain("No flow data");
  });

  it("converts a single edge", () => {
    const result = flowEdgesToMermaid([{ from: "A", to: "B" }]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("graph LR");
    expect(lines[1]).toContain("-->");
    expect(lines[1]).toContain('"A"');
    expect(lines[1]).toContain('"B"');
  });

  it("converts an edge with a label", () => {
    const result = flowEdgesToMermaid([{ from: "A", to: "B", label: "calls" }]);
    expect(result).toContain("-->|");
    expect(result).toContain('"calls"');
  });

  it("assigns unique IDs to nodes", () => {
    const result = flowEdgesToMermaid([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    // B should appear with the same node ID in both edges
    const lines = result.split("\n").slice(1);
    // Extract node IDs (N0, N1, N2, etc.)
    const ids = lines.flatMap((l) => {
      const matches = l.match(/N\d+/g);
      return matches || [];
    });
    // N1 (for "B") should appear twice: once as target, once as source
    const n1Count = ids.filter((id) => id === "N1").length;
    expect(n1Count).toBe(2);
  });

  it("handles special characters in node names", () => {
    const result = flowEdgesToMermaid([{ from: 'A"B', to: "C<D>" }]);
    // Node labels should be JSON-stringified (escaped)
    expect(result).toContain('"A\\"B"');
    expect(result).toContain('"C<D>"');
  });

  it("starts with valid mermaid graph LR directive", () => {
    const result = flowEdgesToMermaid([{ from: "X", to: "Y" }]);
    expect(result.startsWith("graph LR")).toBe(true);
  });

  it("handles self-loop (same from and to)", () => {
    const result = flowEdgesToMermaid([{ from: "A", to: "A" }]);
    expect(result).toContain("-->");
    // Same node ID should appear on both sides
    const match = result.match(/N0/g);
    expect(match).not.toBeNull();
    expect(match!.length).toBe(2);
  });

  it("handles large number of edges", () => {
    const edges = Array.from({ length: 15 }, (_, i) => ({
      from: `node${i}`,
      to: `node${i + 1}`,
    }));
    const result = flowEdgesToMermaid(edges);
    const lines = result.split("\n");
    // header + 15 edges
    expect(lines.length).toBe(16);
  });

  it("handles Unicode characters in node names", () => {
    const result = flowEdgesToMermaid([{ from: "función", to: "処理" }]);
    expect(result).toContain("función");
    expect(result).toContain("処理");
  });
});
