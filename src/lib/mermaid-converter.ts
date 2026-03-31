import type { FlowEdge } from "../types/panel";

export function flowEdgesToMermaid(edges: FlowEdge[]): string {
  if (edges.length === 0) return "graph LR\n  A[\"No flow data\"]";

  const lines = ["graph LR"];

  // Collect unique nodes and sanitize IDs
  const nodeIds = new Map<string, string>();
  let counter = 0;

  function getNodeId(name: string): string {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `N${counter++}`);
    }
    return nodeIds.get(name)!;
  }

  for (const edge of edges) {
    const fromId = getNodeId(edge.from);
    const toId = getNodeId(edge.to);
    const fromLabel = JSON.stringify(edge.from);
    const toLabel = JSON.stringify(edge.to);

    if (edge.label) {
      const edgeLabel = JSON.stringify(edge.label);
      lines.push(`  ${fromId}[${fromLabel}] -->|${edgeLabel}| ${toId}[${toLabel}]`);
    } else {
      lines.push(`  ${fromId}[${fromLabel}] --> ${toId}[${toLabel}]`);
    }
  }

  return lines.join("\n");
}
