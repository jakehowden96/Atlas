<script lang="ts">
  import type { SpendFlow } from "../../../../types/codeburn-spend";
  import { fmtCost } from "../../../stats-derive";

  let {
    flow,
    maxProjects = 6,
    onselect,
    active,
  }: {
    flow: SpendFlow;
    maxProjects?: number;
    /** Click a project node; "Other" is a bucket and never selects. */
    onselect?: (projectId: string) => void;
    /** Project id drawn in the accent colour. */
    active?: string;
  } = $props();

  /** What the pointer is on: a model (l), a project (r), or one ribbon (both). Unrelated ribbons fade. */
  let hl = $state<{ l?: string; r?: string } | null>(null);
  const faded = (m: string, p: string) =>
    hl !== null && !((hl.l === undefined || hl.l === m) && (hl.r === undefined || hl.r === p));

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
    const ribbons: { key: string; m: string; p: string; d: string; fill: string; text: string }[] =
      [];
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
        m,
        p,
        d: `M${LX},${y0}C${mid},${y0} ${mid},${y1} ${RX},${y1}L${RX},${y1 + h}C${mid},${y1 + h} ${mid},${y0 + h} ${LX},${y0 + h}Z`,
        fill: color(a.label),
        text: `${a.label} → ${b.label} · ${fmtCost(cost)}`,
      });
    }
    const end = (a: Node[]) => a.reduce((m, x) => Math.max(m, x.y + x.h), 0);
    return { L, R, ribbons, H: Math.max(end(L), end(R)) + 4 };
  });
</script>

{#snippet node(n: Node, on: boolean)}
  <rect x={RX} y={n.y} width="4" height={n.h} fill={on ? "var(--accent)" : "var(--muted)"} />
  <text x={RX + 10} y={n.y + n.h / 2 + 4}>{n.label} · {fmtCost(n.cost)}</text>
{/snippet}

{#if layout.ribbons.length === 0}
  <p class="empty">No spend</p>
{:else}
  <div class="flow">
    <svg
      viewBox={`0 0 ${W} ${layout.H}`}
      role="group"
      aria-label="Spend flow from model to project"
      onpointerleave={() => (hl = null)}
    >
      {#each layout.ribbons as r (r.key)}
        <path
          role="img"
          aria-label={r.text}
          d={r.d}
          fill={r.fill}
          fill-opacity="0.4"
          class:fade={faded(r.m, r.p)}
          onpointerenter={() => (hl = { l: r.m, r: r.p })}><title>{r.text}</title></path
        >
      {/each}
      {#each layout.L as n (n.id)}
        <g
          role="img"
          aria-label={`${n.label} · ${fmtCost(n.cost)}`}
          onpointerenter={() => (hl = { l: n.id })}
        >
          <rect x={LX - 4} y={n.y} width="4" height={n.h} fill={color(n.label)} />
          <text x={LX - 10} y={n.y + n.h / 2 + 4} text-anchor="end"
            >{n.label} · {fmtCost(n.cost)}</text
          >
        </g>
      {/each}
      {#each layout.R as n (n.id)}
        {@const on = n.id === active}
        {#if onselect && n.id !== OTHER}
          <g
            class="pick"
            class:on
            role="button"
            tabindex="0"
            aria-pressed={on}
            aria-label={`${n.label} · ${fmtCost(n.cost)}, ${on ? "click to clear filter" : "click to filter"}`}
            onpointerenter={() => (hl = { r: n.id })}
            onfocus={() => (hl = { r: n.id })}
            onblur={() => (hl = null)}
            onclick={() => onselect(n.id)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onselect(n.id);
              }
            }}
          >
            {@render node(n, on)}
          </g>
        {:else}
          <g
            role="img"
            aria-label={`${n.label} · ${fmtCost(n.cost)}`}
            onpointerenter={() => (hl = { r: n.id })}
          >
            {@render node(n, on)}
          </g>
        {/if}
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
  path {
    transition: opacity 0.15s;
  }
  .fade {
    opacity: 0.08;
  }
  .pick {
    cursor: pointer;
    outline: none;
  }
  .pick:hover text,
  .pick:focus-visible text {
    fill: var(--text);
    text-decoration: underline;
  }
  .on text {
    fill: var(--accent);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
