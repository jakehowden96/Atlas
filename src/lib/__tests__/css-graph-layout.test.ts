import { describe, it, expect } from "vitest";
import { layoutFlowGraphCSS, layoutFlowGraphChunked } from "../css-graph-layout";

describe("layoutFlowGraphCSS", () => {
  it("returns empty layout for empty edges", () => {
    const result = layoutFlowGraphCSS([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it("creates nodes and edges for a single edge", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B" }]);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(result.edges[0].source).toBe("A");
    expect(result.edges[0].target).toBe("B");
  });

  it("normalizes positions to (0,0) origin", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B" }]);
    const minX = Math.min(...result.nodes.map((n) => n.x));
    const minY = Math.min(...result.nodes.map((n) => n.y));
    expect(minX).toBe(0);
    expect(minY).toBe(0);
  });

  it("computes positive bounding box dimensions", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B" }]);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("bounding box contains all nodes", () => {
    const result = layoutFlowGraphCSS([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "A", to: "C" },
    ]);
    for (const node of result.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(result.width + 0.01);
      expect(node.y + node.height).toBeLessThanOrEqual(result.height + 0.01);
      expect(node.x).toBeGreaterThanOrEqual(-0.01);
      expect(node.y).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it("populates edge points arrays", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B" }]);
    expect(result.edges[0].points.length).toBeGreaterThan(0);
    for (const pt of result.edges[0].points) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    }
  });

  it("edge points are normalized within bounding box", () => {
    const result = layoutFlowGraphCSS([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    for (const edge of result.edges) {
      for (const pt of edge.points) {
        expect(pt.x).toBeGreaterThanOrEqual(-1);
        expect(pt.y).toBeGreaterThanOrEqual(-1);
      }
    }
  });

  it("preserves edge labels", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B", label: "calls" }]);
    expect(result.edges[0].label).toBe("calls");
  });

  it("omits label when edge has no label", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B" }]);
    expect(result.edges[0].label).toBeUndefined();
  });

  it("deduplicates shared nodes", () => {
    const result = layoutFlowGraphCSS([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    expect(result.nodes).toHaveLength(3);
  });

  it("produces non-overlapping nodes", () => {
    const result = layoutFlowGraphCSS([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i];
        const b = result.nodes[j];
        const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("uses top-to-bottom layout (source above target)", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "B" }]);
    const a = result.nodes.find((n) => n.id === "A")!;
    const b = result.nodes.find((n) => n.id === "B")!;
    expect(b.y).toBeGreaterThan(a.y);
  });

  it("handles self-loop", () => {
    const result = layoutFlowGraphCSS([{ from: "A", to: "A" }]);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("A");
    expect(result.edges[0].target).toBe("A");
  });

  it("handles large number of edges", () => {
    const edges = Array.from({ length: 15 }, (_, i) => ({
      from: `node${i}`,
      to: `node${i + 1}`,
    }));
    const result = layoutFlowGraphCSS(edges);
    expect(result.nodes).toHaveLength(16);
    expect(result.edges).toHaveLength(15);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("handles Unicode characters in node names", () => {
    const result = layoutFlowGraphCSS([{ from: "función", to: "処理" }]);
    const labels = result.nodes.map((n) => n.label).sort();
    expect(labels).toContain("función");
    expect(labels).toContain("処理");
  });

  it("generates unique edge IDs", () => {
    const result = layoutFlowGraphCSS([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "A", to: "C" },
    ]);
    const ids = result.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns consistent dimensions to all nodes", () => {
    const result = layoutFlowGraphCSS([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    for (const node of result.nodes) {
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  describe("maxWidth constraint", () => {
    it("constrains graph width to maxWidth", () => {
      // A->B and A->C creates two side-by-side nodes in the same rank
      const result = layoutFlowGraphCSS(
        [
          { from: "A", to: "B" },
          { from: "A", to: "C" },
        ],
        300,
      );
      expect(result.width).toBeLessThanOrEqual(300);
    });

    it("shrinks node widths to fit within maxWidth", () => {
      const unconstrained = layoutFlowGraphCSS([
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ]);
      const constrained = layoutFlowGraphCSS(
        [
          { from: "A", to: "B" },
          { from: "A", to: "C" },
        ],
        250,
      );
      expect(constrained.nodes[0].width).toBeLessThanOrEqual(
        unconstrained.nodes[0].width,
      );
    });

    it("does not shrink nodes below minimum width", () => {
      const result = layoutFlowGraphCSS(
        [
          { from: "A", to: "B" },
          { from: "A", to: "C" },
        ],
        50, // impossibly small
      );
      for (const node of result.nodes) {
        expect(node.width).toBeGreaterThanOrEqual(120);
      }
    });

    it("works without maxWidth (unconstrained)", () => {
      const result = layoutFlowGraphCSS([
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ]);
      // Should still produce a valid layout
      expect(result.nodes).toHaveLength(3);
      expect(result.width).toBeGreaterThan(0);
    });
  });
});

describe("layoutFlowGraphChunked", () => {
  it("returns empty chunks for empty edges", () => {
    const result = layoutFlowGraphChunked([]);
    expect(result.chunks).toEqual([]);
  });

  it("returns one chunk for a single connected graph", () => {
    const result = layoutFlowGraphChunked([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].nodes).toHaveLength(3);
    expect(result.chunks[0].edges).toHaveLength(2);
  });

  it("returns two chunks for two disconnected subgraphs", () => {
    const result = layoutFlowGraphChunked([
      { from: "A", to: "B" },
      { from: "C", to: "D" },
    ]);
    expect(result.chunks).toHaveLength(2);

    const allNodeIds = result.chunks.flatMap((c) => c.nodes.map((n) => n.id));
    expect(allNodeIds.sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("derives chunk title from file prefixes", () => {
    const result = layoutFlowGraphChunked([
      { from: "panel.rs::refresh", to: "panel.rs::save" },
    ]);
    expect(result.chunks[0].title).toBe("panel.rs");
  });

  it("joins multiple file prefixes in title", () => {
    const result = layoutFlowGraphChunked([
      { from: "panel.rs::refresh", to: "watcher.rs::emit" },
    ]);
    expect(result.chunks[0].title).toBe("panel.rs / watcher.rs");
  });

  it("falls back to 'Graph' when node IDs have no :: separator", () => {
    const result = layoutFlowGraphChunked([{ from: "A", to: "B" }]);
    expect(result.chunks[0].title).toBe("Graph");
  });

  it("each chunk has valid layout dimensions", () => {
    const result = layoutFlowGraphChunked([
      { from: "A", to: "B" },
      { from: "C", to: "D" },
    ]);
    for (const chunk of result.chunks) {
      expect(chunk.width).toBeGreaterThan(0);
      expect(chunk.height).toBeGreaterThan(0);
    }
  });

  it("each chunk has nodes within its bounds", () => {
    const result = layoutFlowGraphChunked([
      { from: "A", to: "B" },
      { from: "C", to: "D" },
    ]);
    for (const chunk of result.chunks) {
      for (const node of chunk.nodes) {
        expect(node.x + node.width).toBeLessThanOrEqual(chunk.width + 0.01);
        expect(node.y + node.height).toBeLessThanOrEqual(chunk.height + 0.01);
      }
    }
  });

  it("propagates maxWidth constraint to chunks", () => {
    const result = layoutFlowGraphChunked(
      [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ],
      300,
    );
    expect(result.chunks[0].width).toBeLessThanOrEqual(300);
  });

  it("handles self-loop edge", () => {
    const result = layoutFlowGraphChunked([{ from: "A", to: "A" }]);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].nodes).toHaveLength(1);
    expect(result.chunks[0].edges).toHaveLength(1);
  });
});
