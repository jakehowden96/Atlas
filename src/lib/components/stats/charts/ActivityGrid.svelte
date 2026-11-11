<script lang="ts">
  import { localDayKey } from "../../../stats-derive";
  import type { Point } from "../../../stats-chart";
  import { tooltip } from "../../../ui/tooltip";

  interface Props {
    /** Per-day values keyed YYYY-MM-DD; the last non-pad key is the final day shown. */
    cells: Point[];
    /** Singular noun for the tooltip: "call". */
    noun: string;
  }

  let { cells, noun }: Props = $props();

  const weeks = 20;
  const real = $derived(cells.filter((c) => !c.key.startsWith("pad")));
  const by = $derived(new Map(real.map((c) => [c.key, c.value])));
  const max = $derived(Math.max(0, ...real.map((c) => c.value)));
  /** 20 Monday-first week columns ending on the last day with data; days before the data read as empty. */
  const grid = $derived.by(() => {
    const lastKey = real[real.length - 1]?.key;
    if (!lastKey) return { days: [], months: [] };
    const end = new Date(`${lastKey}T00:00:00`);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - ((end.getDay() + 6) % 7) - 7 * (weeks - 1));
    const days: { key: string; col: number; row: number; value: number; label: string; now: boolean }[] = [];
    const months: { col: number; name: string }[] = [];
    let lastMonth = -1;
    for (let c = 0; c < weeks; c++)
      for (let r = 0; r < 7; r++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + c * 7 + r);
        if (d > end) continue;
        const key = localDayKey(d);
        if (r === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) {
          lastMonth = d.getMonth();
          months.push({ col: c, name: d.toLocaleDateString(undefined, { month: "short" }) });
        }
        days.push({
          key,
          col: c,
          row: r,
          value: by.get(key) ?? 0,
          label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          now: key === lastKey,
        });
      }
    return { days, months };
  });
  const step = (v: number) => (v > 0 && max > 0 ? Math.min(4, Math.ceil((v / max) * 4)) : 0);
  const tip = (d: { label: string; value: number }) => `${d.label}, ${d.value} ${noun}${d.value === 1 ? "" : "s"}`;
</script>

<div class="hm" role="img" aria-label="Activity per day">
  {#each grid.months as m (m.col)}<span style:grid-column={`${m.col + 2} / span 3`} style:grid-row="1">{m.name}</span>{/each}
  {#each ["Mon", "Wed", "Fri"] as n, j (n)}<span style:grid-column="1" style:grid-row={2 + j * 2}>{n}</span>{/each}
  {#each grid.days as d (d.key)}
    <i
      class:now={d.now}
      style:grid-column={d.col + 2}
      style:grid-row={d.row + 2}
      style:background={step(d.value) ? `color-mix(in srgb, var(--accent) ${step(d.value) * 25}%, var(--surface3))` : undefined}
      use:tooltip={{ text: tip(d), delay: 0, side: "top" }}
    ></i>
  {/each}
</div>

<style>
  .hm {
    display: grid;
    grid-template-columns: 26px repeat(20, minmax(0, 1fr));
    grid-template-rows: 14px repeat(7, auto);
    gap: 2px;
    width: 100%;
    max-width: 320px;
    color: var(--muted);
    font-size: var(--fs-2xs);
    line-height: 10px;
  }
  span {
    white-space: nowrap;
  }
  i {
    aspect-ratio: 1;
    border-radius: var(--r-xs);
    background: var(--surface3);
    cursor: default;
  }
  i:hover {
    outline: 1.5px solid var(--text);
    outline-offset: 1px;
  }
  i.now {
    outline: 1.5px solid var(--text);
    outline-offset: 1px;
  }
</style>
