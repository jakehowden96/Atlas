<script lang="ts">
  import type { SpendFlow } from "../../../../types/codeburn-spend";
  import { fmtCost } from "../../../stats-derive";

  let { flow, maxProjects = 6 }: { flow: SpendFlow; maxProjects?: number } = $props();

  // Geometry mirrors the design: wide canvas, 4px nodes, ribbons at 40% opacity.
  const W = 900;
  const LX = 230;
  const RX = 640;
  const GAP = 4;
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
    const u = total > 0 ? 140 / total : 0;
    const stack = (xs: { id: string; label: string; cost: number }[]): Node[] => {
      let y = 0;
      return xs.map((x) => {
        const n = { ...x, y, h: Math.max(10, x.cost * u), off: 0 };
        y += n.h + GAP;
        return n;
      });
    };
    const L = stack(left);
    const R = stack(right);
    const li = new Map(L.map((n) => [n.id, n]));
    const ri = new Map(R.map((n) => [n.id, n]));
    const mid = (LX + RX) / 2;
    const ribbons: { key: string; d: string; fill: string; text: string }[] = [];
    for (const [key, cost] of [...pairs].sort((a, b) => b[1] - a[1])) {
      const [m, p] = key.split("\0") as [string, string];
      const a = li.get(m);
      const b = ri.get(p);
      if (!a || !b) continue;
      const h = cost * u;
      const y0 = a.y + a.off;
      const y1 = b.y + b.off;
      a.off += h;
      b.off += h;
      ribbons.push({
        key,
        d: `M${LX},${y0}C${mid},${y0} ${mid},${y1} ${RX},${y1}L${RX},${y1 + h}C${mid},${y1 + h} ${mid},${y0 + h} ${LX},${y0 + h}Z`,
        fill: color(a.label),
        text: `${a.label} → ${b.label} · ${fmtCost(cost)}`,
      });
    }
    const end = (a: Node[]) => a.reduce((m, x) => Math.max(m, x.y + x.h), 0);
    return { L, R, ribbons, H: Math.max(end(L), end(R)) + 4 };
  });
</script>

{#if layout.ribbons.length === 0}
  <p class="empty">No spend</p>
{:else}
  <div class="flow">
    <svg viewBox={`0 0 ${W} ${layout.H}`} role="img" aria-label="Spend flow from model to project">
      {#each layout.ribbons as r (r.key)}
        <path d={r.d} fill={r.fill} fill-opacity="0.4"><title>{r.text}</title></path>
      {/each}
      {#each layout.L as n (n.id)}
        <rect x={LX - 4} y={n.y} width="4" height={n.h} fill={color(n.label)} />
        <text x={LX - 10} y={n.y + n.h / 2 + 4} text-anchor="end">{n.label} · {fmtCost(n.cost)}</text>
      {/each}
      {#each layout.R as n (n.id)}
        <rect x={RX} y={n.y} width="4" height={n.h} fill="var(--muted)" />
        <text x={RX + 10} y={n.y + n.h / 2 + 4}>{n.label} · {fmtCost(n.cost)}</text>
      {/each}
    </svg>
  </div>
{/if}

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  text {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
