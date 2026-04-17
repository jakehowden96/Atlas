import dagre from "@dagrejs/dagre";
import type { FlowEdge } from "../types/panel";

interface DagreNodeData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  edge_type?: string;
  points: { x: number; y: number }[];
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface GraphChunk {
  title: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface ChunkedGraphLayout {
  chunks: GraphChunk[];
}

const NODE_HEIGHT = 58;
const MIN_NODE_WIDTH = 120;
const NODESEP = 24;
const RANKSEP = 50;

/**
 * Layout a flow graph using dagre, constrained to fit within maxWidth.
 * If maxWidth is provided, node widths are shrunk so that the widest
 * rank (row of side-by-side nodes) fits without horizontal overflow.
 */
export function layoutFlowGraphCSS(
  edges: FlowEdge[],
  maxWidth?: number,
): GraphLayout {
  const nodeNames = new Set<string>();
  for (const e of edges) {
    nodeNames.add(e.from);
    nodeNames.add(e.to);
  }

  if (nodeNames.size === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // First pass: run dagre to discover how many nodes share a rank (row)
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: NODESEP, ranksep: RANKSEP });

  // Start with a default node width
  let nodeWidth = 192;

  for (const name of nodeNames) {
    g.setNode(name, { width: nodeWidth, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  // Find the max number of nodes at any rank (horizontal row)
  if (maxWidth && maxWidth > 0) {
    const rankCounts = new Map<number, number>();
    for (const id of g.nodes()) {
      const n = g.node(id);
      const rank = n.rank ?? 0;
      rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
    }
    const maxPerRank = Math.max(...rankCounts.values(), 1);

    // Calculate node width that fits: maxPerRank * nodeWidth + (maxPerRank-1) * nodesep <= maxWidth
    if (maxPerRank > 0) {
      const available = maxWidth - (maxPerRank - 1) * NODESEP;
      const fittedWidth = Math.floor(available / maxPerRank);
      nodeWidth = Math.max(Math.min(fittedWidth, 192), MIN_NODE_WIDTH);
    }

    // Re-layout with fitted node width
    const g2 = new dagre.graphlib.Graph();
    g2.setDefaultEdgeLabel(() => ({}));
    g2.setGraph({ rankdir: "TB", nodesep: NODESEP, ranksep: RANKSEP });
    for (const name of nodeNames) {
      g2.setNode(name, { width: nodeWidth, height: NODE_HEIGHT });
    }
    for (const e of edges) {
      g2.setEdge(e.from, e.to);
    }
    dagre.layout(g2);

    return buildResult(g2, edges, nodeWidth);
  }

  return buildResult(g, edges, nodeWidth);
}

function buildResult(
  g: InstanceType<typeof dagre.graphlib.Graph>,
  edges: FlowEdge[],
  nodeWidth: number,
): GraphLayout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of g.nodes()) {
    const n = g.node(id) as DagreNodeData;
    const left = n.x - nodeWidth / 2;
    const top = n.y - NODE_HEIGHT / 2;
    const right = n.x + nodeWidth / 2;
    const bottom = n.y + NODE_HEIGHT / 2;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }

  const nodes: LayoutNode[] = g.nodes().map((id: string) => {
    const n = g.node(id) as DagreNodeData;
    return {
      id,
      label: id,
      x: n.x - nodeWidth / 2 - minX,
      y: n.y - NODE_HEIGHT / 2 - minY,
      width: nodeWidth,
      height: NODE_HEIGHT,
    };
  });

  const layoutEdges: LayoutEdge[] = edges.map((e, i) => {
    const edgeData = g.edge(e.from, e.to) as { points?: { x: number; y: number }[] } | undefined;
    const points = (edgeData?.points ?? []).map((p: { x: number; y: number }) => ({
      x: p.x - minX,
      y: p.y - minY,
    }));
    return {
      id: `e${i}`,
      source: e.from,
      target: e.to,
      label: e.label,
      edge_type: e.edge_type,
      points,
    };
  });

  return {
    nodes,
    edges: layoutEdges,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function findConnectedComponents(edges: FlowEdge[]): Set<string>[] {
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
    if (!adjacency.has(e.to)) adjacency.set(e.to, new Set());
    adjacency.get(e.from)!.add(e.to);
    adjacency.get(e.to)!.add(e.from);
  }

  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    const component = new Set<string>();
    const queue = [node];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.add(current);
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

function deriveChunkTitle(nodeIds: Set<string>): string {
  const files = new Set<string>();
  for (const id of nodeIds) {
    const sep = id.indexOf("::");
    if (sep > 0) files.add(id.slice(0, sep));
  }
  if (files.size === 0) return "Graph";
  return [...files].sort().join(" / ");
}

export function extractFileColorMap(edges: FlowEdge[]): Map<string, number> {
  const files = new Set<string>();
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      const sep = id.indexOf("::");
      if (sep > 0) files.add(id.slice(0, sep));
    }
  }
  const sorted = [...files].sort();
  const map = new Map<string, number>();
  sorted.forEach((f, i) => map.set(f, i));
  return map;
}

/**
 * Layout a flow graph as vertical chunks — one chunk per connected component.
 * Each chunk is independently laid out with dagre then stacked vertically.
 */
export function layoutFlowGraphChunked(
  edges: FlowEdge[],
  maxWidth?: number,
): ChunkedGraphLayout {
  if (edges.length === 0) {
    return { chunks: [] };
  }

  const components = findConnectedComponents(edges);
  const chunks: GraphChunk[] = [];

  for (const component of components) {
    const componentEdges = edges.filter(
      (e) => component.has(e.from) && component.has(e.to),
    );
    if (componentEdges.length === 0) continue;

    const layout = layoutFlowGraphCSS(componentEdges, maxWidth);
    const title = deriveChunkTitle(component);

    chunks.push({
      title,
      nodes: layout.nodes,
      edges: layout.edges,
      width: layout.width,
      height: layout.height,
    });
  }

  return { chunks };
}
