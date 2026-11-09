<script lang="ts">
  import type { SpendFlow } from "../../../../types/codeburn-spend";
  import { fmtCost } from "../../../stats-derive";

  let { flow, maxProjects = 10 }: { flow: SpendFlow; maxProjects?: number } = $props();

  const W = 720;
  const H = 260;
  const NODE_W = 10;
  const GAP = 6;
  const LABEL_W = 150;
  const OTHER = "__other__";

  const color = (label: string) => {
    const fam = ["opus", "sonnet", "haiku"].find((f) => label.toLowerCase().includes(f));
    return fam ? `var(--model-${fam})` : "var(--muted)";
  };

  interface Node {
    id: string;
    label: string;
    cost: number;
    y: number;
    h: number;
    off: number;
  }

  /** Stacks nodes top to bottom, scaled so the taller side fits H. */
  function stack(xs: { id: string; label: string; cost: number }[], k: number): Node[] {
    let y = 0;
    return xs.map((x) => {
      const n = { ...x, y, h: x.cost * k, off: 0 };
      y += n.h + GAP;
      return n;
    });
  }

  const layout = $derived.by(() => {
    const ranked = [...flow.projects]
      .filter((p) => p.id !== OTHER && p.cost > 0)
      .sort((a, b) => b.cost - a.cost);
    const keep = new Set(ranked.slice(0, maxProjects).map((p) => p.id));
    const target = (id: string) => (keep.has(id) ? id : OTHER);
    const merged = new Map<string, number>();
    const pairs = new Map<string, number>();
    for (const l of flow.links) {
      const p = target(l.project);
      merged.set(p, (merged.get(p) ?? 0) + l.cost);
      pairs.set(`${l.model}\0${p}`, (pairs.get(`${l.model}\0${p}`) ?? 0) + l.cost);
    }
    const right = ranked
      .slice(0, maxProjects)
      .map((p) => ({ id: p.id, label: p.label, cost: merged.get(p.id) ?? 0 }))
      .filter((p) => p.cost > 0);
    if (merged.get(OTHER)) right.push({ id: OTHER, label: "Other", cost: merged.get(OTHER)! });
    const left = flow.models.filter((m) => m.cost > 0).sort((a, b) => b.cost - a.cost);
    const total = right.reduce((s, p) => s + p.cost, 0);
    const room = (n: number) => H - GAP * Math.max(0, n - 1);
    const k = total > 0 ? Math.min(room(left.length), room(right.length)) / total : 0;
    const L = stack(left, k);
    const R = stack(right, k);
    const li = new Map(L.map((n) => [n.id, n]));
    const ri = new Map(R.map((n) => [n.id, n]));
    const ribbons: { key: string; d: string; w: number; fill: string; text: string }[] = [];
    // Largest first within each node so ribbons do not cross more than they must.
    const sorted = [...pairs].sort((a, b) => b[1] - a[1]);
    for (const [key, cost] of sorted) {
      const [m, p] = key.split("\0") as [string, string];
      const a = li.get(m);
      const b = ri.get(p);
      if (!a || !b) continue;
      const w = cost * k;
      const y1 = a.y + a.off + w / 2;
      const y2 = b.y + b.off + w / 2;
      a.off += w;
      b.off += w;
      const x1 = LABEL_W + NODE_W;
      const x2 = W - LABEL_W - NODE_W;
      const mid = (x1 + x2) / 2;
      ribbons.push({
        key,
        d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
        w: Math.max(w, 1),
        fill: color(a.label),
        text: `${a.label} → ${b.label}: ${fmtCost(cost)}`,
      });
    }
    return { L, R, ribbons };
  });
</script>

{#if layout.ribbons.length === 0}
  <p class="empty">No spend</p>
{:else}
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cost flow from model to project">
    {#each layout.ribbons as r (r.key)}
      <path d={r.d} stroke={r.fill} stroke-width={r.w} fill="none" opacity="0.4"><title>{r.text}</title></path>
    {/each}
    {#each layout.L as n (n.id)}
      <rect x={LABEL_W} y={n.y} width={NODE_W} height={Math.max(n.h, 1)} fill={color(n.label)} />
      <text x={LABEL_W - 6} y={n.y + n.h / 2} text-anchor="end" dominant-baseline="middle">
        {n.label} {fmtCost(n.cost)}
      </text>
    {/each}
    {#each layout.R as n (n.id)}
      <rect x={W - LABEL_W - NODE_W} y={n.y} width={NODE_W} height={Math.max(n.h, 1)} fill="var(--muted)" />
      <text x={W - LABEL_W + 6} y={n.y + n.h / 2} dominant-baseline="middle">
        {n.label} {fmtCost(n.cost)}
      </text>
    {/each}
  </svg>
{/if}

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  text {
    fill: var(--text);
    font-size: var(--fs-2xs);
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
