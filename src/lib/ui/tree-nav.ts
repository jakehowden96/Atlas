/** W3C tree keyboard model over a flat list of visible nodes. Pure; the caller applies the result. */
export interface TreeNode {
  id: string;
  level: number;
  expandable: boolean;
  expanded: boolean;
  parentId: string | null;
  label?: string;
}

export interface NavResult {
  /** Id to move focus to (may equal the current id). */
  focusId: string;
  /** Expand or collapse intent for `id`; the caller performs it. */
  toggle?: { id: string; expand: boolean };
}

export function navigate(nodes: TreeNode[], currentId: string, key: string): NavResult | null {
  const i = nodes.findIndex((n) => n.id === currentId);
  if (i < 0) return null;
  const cur = nodes[i];
  if (!cur) return null;
  const at = (j: number) => (nodes[Math.min(Math.max(j, 0), nodes.length - 1)] ?? cur).id;
  switch (key) {
    case "ArrowDown":
      return { focusId: at(i + 1) };
    case "ArrowUp":
      return { focusId: at(i - 1) };
    case "Home":
      return { focusId: at(0) };
    case "End":
      return { focusId: at(nodes.length - 1) };
    case "ArrowRight":
      if (!cur.expandable) return { focusId: cur.id };
      if (!cur.expanded) return { focusId: cur.id, toggle: { id: cur.id, expand: true } };
      // Expanded: the first child is the next visible row.
      return { focusId: nodes[i + 1]?.parentId === cur.id ? at(i + 1) : cur.id };
    case "ArrowLeft":
      if (cur.expandable && cur.expanded)
        return { focusId: cur.id, toggle: { id: cur.id, expand: false } };
      return { focusId: cur.parentId ?? cur.id };
    default:
      return null;
  }
}

/** Next node whose label starts with `query` (case-insensitive). A single character, or the
 * same character repeated, cycles from after the current node; otherwise matching starts at it. */
export function typeahead(nodes: TreeNode[], currentId: string, query: string): string | null {
  const q = query.toLowerCase();
  if (!q) return null;
  const i = Math.max(
    0,
    nodes.findIndex((n) => n.id === currentId),
  );
  const cycle = [...q].every((c) => c === q[0]);
  const needle = cycle ? q.slice(0, 1) : q;
  const start = cycle ? i + 1 : i;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[(start + k) % nodes.length];
    if (n?.label?.toLowerCase().startsWith(needle)) return n.id;
  }
  return null;
}
