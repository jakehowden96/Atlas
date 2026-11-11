<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PeriodCompare, PeriodTotals } from "../../../../types/codeburn-compare";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import SegmentedControl from "../../ui/SegmentedControl.svelte";
  import { dayPairs, movers, presetRanges, sortMovers, type Basis, type MoverSort } from "./compare-periods-derive";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  interface Daily {
    daily: { date: string; cost: number }[];
  }
  
  const PREVIEW = 5;
  const COUNTED = [
    ["Cost", "API-equivalent dollars for every call in the window, priced from token counts. Not what a subscription bills."],
    ["Calls", "Each request sent to a model. Tool results fed back count as new calls."],
    ["Sessions", "Distinct conversations with at least one call in the window."],
    ["Cost per 100 calls", "Cost divided by calls, times 100. Lower means each call was cheaper."],
    ["Tokens", "Input and output are fresh tokens. Cache read is context reused from cache, cache write is context stored for later."],
    ["B − A", "Every difference is B minus A. Swap the periods to flip the signs."],
    ["Movers", "Projects and models split the same difference two ways. Do not add them together."],
  ];
  const H = 170;
  const L = 8;
  const R = 46;
  const T = 10;
  const BT = 22;

  let mode = $state<"preset" | "custom">("preset");
  let r = $state(presetRanges(new Date()));
  let by = $state<"projects" | "models">("projects");
  let basis = $state<Basis>("raw");
  let all = $state(false);
  let sort = $state<{ k: MoverSort; dir: 1 | -1 }>({ k: "ad", dir: -1 });
  let det = $state({ metrics: false, counted: false });
  let cw = $state(640);
  let hi = $state<number | null>(null);

  const valid = $derived(
    [r.a0, r.a1, r.b0, r.b1].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && r.a0 <= r.a1 && r.b0 <= r.b1,
  );
  const fl = $derived(filterArgs(filters, "compare-periods"));

  function setMode(m: "preset" | "custom") {
    mode = m;
    if (m === "preset") r = presetRanges(new Date());
  }
  function swap() {
    r = { a0: r.b0, a1: r.b1, b0: r.a0, b1: r.a1 };
  }
  function sortBy(k: MoverSort) {
    sort = sort.k === k ? { k, dir: sort.dir === 1 ? -1 : 1 } : { k, dir: k === "key" ? 1 : -1 };
  }

  const win = (from: string, to: string) => ["--from", from, "--to", to];
  const utc = (d: string) => new Date(`${d}T00:00:00Z`);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  const short = (d: string) => fmt(d, { month: "short", day: "numeric" });
  const full = (d: string) => fmt(d, { month: "short", day: "numeric", year: "numeric" });
  const rng = (x: { from: string; to: string }) =>
    x.from === x.to
      ? short(x.from)
      : x.from.slice(0, 7) === x.to.slice(0, 7)
        ? `${short(x.from)}–${utc(x.to).getUTCDate()}`
        : `${short(x.from)}–${short(x.to)}`;
  const dayAt = (d: string, i: number) => short(new Date(utc(d).getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const len = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000) + 1;
  const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  const sign = (x: number) => (x < 0 ? "−" : "+");
  const fp = (x: number) => `${sign(x)}${Math.round(Math.abs(x)).toLocaleString("en-US")}%`;
  const fd = (x: number, f: (v: number) => string) => `${sign(x)}${f(Math.abs(x))}`;
  const tone = (d: number) => (d > 0 ? "up" : d < 0 ? "down" : "");
  const r0 = (x: number) => Math.round(Math.abs(x)).toLocaleString("en-US");
  const ratio = (a: number, b: number) => (a > 0 ? (b / a - 1) * 100 : null);
  const per100 = (t: PeriodTotals) => (t.calls > 0 ? (t.cost / t.calls) * 100 : 0);
  const breakdown = (t: PeriodTotals): [string, string][] => [
    ["Input", fmtTokens(t.inputTokens)],
    ["Output", fmtTokens(t.outputTokens)],
    ["Cache read", fmtTokens(t.cacheReadTokens)],
    ["Cache write", fmtTokens(t.cacheWriteTokens)],
    ["Calls", fmtCount(t.calls)],
  ];

  function metrics(p: PeriodCompare) {
    const m = (t: PeriodTotals, days: number) => ({
      cost: t.cost,
      calls: t.calls,
      sess: t.sessions,
      c100: per100(t),
      cps: t.sessions ? t.cost / t.sessions : 0,
      cpd: t.cost / (days || 1),
      input: t.inputTokens,
      output: t.outputTokens,
      cr: t.cacheReadTokens,
      cw: t.cacheWriteTokens,
    });
    const a = m(p.totals.A, p.rangeA.days);
    const b = m(p.totals.B, p.rangeB.days);
    const rows: [string, keyof typeof a, (v: number) => string, boolean][] = [
      ["Total cost", "cost", fmtCost, true],
      ["Calls", "calls", fmtCount, false],
      ["Sessions", "sess", fmtCount, false],
      ["Cost per 100 calls", "c100", fmtCost, true],
      ["Cost per session", "cps", fmtCost, true],
      ["Cost per day", "cpd", fmtCost, true],
      ["Input tokens", "input", fmtTokens, false],
      ["Output tokens", "output", fmtTokens, false],
      ["Cache read", "cr", fmtTokens, false],
      ["Cache write", "cw", fmtTokens, false],
    ];
    return rows.map(([n, k, f, t]) => ({ n, a: a[k], b: b[k], d: b[k] - a[k], f, t }));
  }

  /** The design's axis: a coarse step so the chart keeps to about three gridlines. */
  function axis(mx: number) {
    const step = [5, 10, 25, 50, 100, 200].find((s) => s * 3 >= mx) ?? 200;
    return { step, top: Math.ceil(mx / step) * step || step };
  }
</script>

<section class="card">
  <div class="bar">
    <SegmentedControl
      role="radiogroup"
      size="sm"
      label="Preset"
      value={mode}
      onChange={setMode}
      options={[
        { id: "preset", label: "Last 7 vs prior 7" },
        { id: "custom", label: "Custom" },
      ]}
    />
    <button class="btn" type="button" onclick={swap}>⇄ Swap</button>
  </div>
  <div class="pp-win">
    <span class="pp-k"><span class="dot" style:background="var(--muted)"></span>A · Reference</span>
    {#if mode === "custom"}
      <input type="date" aria-label="A · Reference start" bind:value={r.a0} />
      <span class="muted">–</span>
      <input type="date" aria-label="A · Reference end" bind:value={r.a1} />
    {:else}
      <span class="pill neutral">{full(r.a0)} – {full(r.a1)}</span>
    {/if}
    <span class="pp-k"><span class="dot" style:background="var(--accent)"></span>B · Analyzed</span>
    {#if mode === "custom"}
      <input type="date" aria-label="B · Analyzed start" bind:value={r.b0} />
      <span class="muted">–</span>
      <input type="date" aria-label="B · Analyzed end" bind:value={r.b1} />
    {:else}
      <span class="pill neutral">{full(r.b0)} – {full(r.b1)}</span>
    {/if}
  </div>
  <p class="sub gap">
    {#if valid}
      A spans {plural(len(r.a0, r.a1))} · B spans {plural(len(r.b0, r.b1))} · all differences are B − A
    {:else}
      Enter all four dates, each window from earlier to later.
    {/if}
  </p>
</section>

{#if valid}
  <Loader
    args={["compare-periods", "--format", "json", "--from-a", r.a0, "--to-a", r.a1, "--from-b", r.b0, "--to-b", r.b1, ...fl]}
    {refresh}
  >
    {#snippet children(p: PeriodCompare)}
      {@const A = p.totals.A}
      {@const B = p.totals.B}
      {@const ch = ratio(A.cost, B.cost)}
      {@const cc = ratio(per100(A), per100(B))}
      {@const ss = ratio(A.sessions, B.sessions)}
      {@const wk =
        p.rangeA.days === 7 && p.rangeB.days === 7 && utc(p.rangeB.from).getTime() - utc(p.rangeA.to).getTime() === 86_400_000}
      {@const who = wk ? `The week of ${short(p.rangeB.from)}` : `Period B (${rng(p.rangeB)})`}
      {@const ref = wk ? "the week before" : `period A (${rng(p.rangeA)})`}
      <section class="card">
        <p class="story">
          {#if ch === null}
            {who} cost <b>{fmtCost(B.cost)}</b>{B.cost > 0 ? " and period A had no spend." : "; there was no spend in either window."}
          {:else}
            {who}{Math.abs(ch) < 1 ? ` cost about the same as ${ref}` : ` cost ${r0(ch)}% ${ch > 0 ? "more" : "less"} than ${ref}`}:
            <b>{fmtCost(B.cost)}</b> versus <b>{fmtCost(A.cost)}</b>.
            {(ss ?? 0) > 25 ? "Far more sessions" : (ss ?? 0) < -25 ? "Far fewer sessions" : "About the same number of sessions"}, and
            {(cc ?? 0) < -5
              ? `cheaper calls: cost per call fell ${r0(cc ?? 0)}%.`
              : (cc ?? 0) > 5
                ? `pricier calls: cost per call rose ${r0(cc ?? 0)}%.`
                : "a similar cost per call."}
          {/if}
        </p>
        <div class="grid g3">
          <div class="card kpi">
            <div class="k">Total cost</div>
            <div class="v">
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div class="pp-tw" tabindex="0" role="group" aria-label="Total cost token breakdown">
                {fmtCost(B.cost)}
                <div class="pp-tt" role="tooltip">
                  {#each breakdown(B) as [k, v] (k)}
                    <div class="kv"><span>{k}</span><span>{v}</span></div>
                  {/each}
                </div>
              </div>
            </div>
            <div class="n"><span class={tone(B.cost - A.cost)}>{fd(B.cost - A.cost, fmtCost)}{A.cost ? `, ${fp(ch ?? 0)}` : ""}</span></div>
          </div>
          <div class="card kpi">
            <div class="k">Cost per 100 calls</div>
            <div class="v">{fmtCost(per100(B))}</div>
            <div class="n">
              <span class={tone(per100(B) - per100(A))}>{fd(per100(B) - per100(A), fmtCost)}{per100(A) ? `, ${fp(cc ?? 0)}` : ""}</span>
            </div>
          </div>
          <div class="card kpi">
            <div class="k">Sessions</div>
            <div class="v">{fmtCount(B.sessions)}</div>
            <div class="n"><span>{fd(B.sessions - A.sessions, String)}{A.sessions ? `, ${fp(ss ?? 0)}` : ""}</span></div>
          </div>
        </div>
      </section>

      <Loader args={["report", "--format", "json", ...win(p.rangeA.from, p.rangeA.to), ...fl]} {refresh}>
        {#snippet children(a: Daily)}
          <Loader args={["report", "--format", "json", ...win(p.rangeB.from, p.rangeB.to), ...fl]} {refresh}>
            {#snippet children(b: Daily)}
              {@const n = Math.max(p.rangeA.days, p.rangeB.days)}
              {@const rows = dayPairs({ A: a.daily, B: b.daily }, p.rangeA.from, p.rangeB.from, n)}
              {@const mx = Math.max(...rows.flatMap((x) => [x.a, x.b]), 0)}
              {@const { step, top } = axis(mx || 1)}
              {@const y = (v: number) => T + (1 - v / top) * (H - T - BT)}
              {@const slot = (cw - L - R) / n}
              {@const bw = Math.max(2, Math.min(20, slot * 0.36))}
              {@const every = Math.ceil(n / Math.max(1, Math.floor((cw - L - R) / 56)))}
              {@const grid = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)}
              <section class="card">
                <h3 class="label">Cost, day by day, both periods side by side</h3>
                <ul class="legend">
                  <li><span class="dot" style:background="var(--muted)"></span>A · {rng(p.rangeA)}</li>
                  <li><span class="dot" style:background="var(--accent)"></span>B · {rng(p.rangeB)}</li>
                </ul>
                <div class="chart" bind:clientWidth={cw}>
                  <svg width={cw} height={H} viewBox={`0 0 ${cw} ${H}`} role="img" aria-label="Daily cost, period A beside period B"
                    onpointermove={(e) => {
                      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                      hi = Math.max(0, Math.min(n - 1, Math.floor((x - L) / slot)));
                    }}
                    onpointerleave={() => (hi = null)}
                  >
                    {#if hi !== null}
                      <rect x={L + hi * slot} y={T} width={slot} height={H - T - BT} style="fill:var(--surface2)" />
                    {/if}
                    {#each grid as t (t)}
                      <line x1={L} x2={cw - R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
                      {#if !(Math.abs(y(t) - y(mx)) < 12 && t)}
                        <text x={cw - R + 6} y={y(t) + 4}>${t}</text>
                      {/if}
                    {/each}
                    {#each rows as x (x.i)}
                      {@const cx = L + (x.i + 0.5) * slot}
                      {#if x.i < p.rangeA.days}
                        <rect x={cx - bw - 1} y={y(x.a)} width={bw} height={y(0) - y(x.a)} style="fill:var(--muted)" />
                      {/if}
                      {#if x.i < p.rangeB.days}
                        <rect x={cx + 1} y={y(x.b)} width={bw} height={y(0) - y(x.b)} style="fill:var(--accent)" />
                      {/if}
                      {#if x.i % every === 0}
                        <text x={cx} y={H - 6} text-anchor="middle">Day {x.i + 1}</text>
                      {/if}
                    {/each}
                    <line x1={L} x2={cw - R} y1={y(mx)} y2={y(mx)} stroke-dasharray="4 3" style="stroke:var(--accent)" />
                    <text x={cw - R + 6} y={y(mx) + 4} style="fill:var(--accent)">{fmtCost(mx)}</text>
                  </svg>
                  {#if hi !== null}
                    {@const i = hi}
                    <div class="tip" style:left={`${Math.max(110, Math.min(cw - 110, L + (i + 0.5) * slot))}px`}>
                      <span>Day {i + 1}</span>
                      {#if i < p.rangeA.days}
                        <span class="part"><span class="dot" style:background="var(--muted)"></span><span class="muted">{dayAt(p.rangeA.from, i)}</span> <b>{fmtCost(rows[i]?.a ?? 0)}</b></span>
                      {/if}
                      {#if i < p.rangeB.days}
                        <span class="part"><span class="dot" style:background="var(--accent)"></span><span class="muted">{dayAt(p.rangeB.from, i)}</span> <b>{fmtCost(rows[i]?.b ?? 0)}</b></span>
                      {/if}
                    </div>
                  {/if}
                </div>
                <p class="sub">Each pair is one day of A beside the same-numbered day of B. Dashed line marks the peak day.</p>
              </section>
            {/snippet}
          </Loader>
        {/snippet}
      </Loader>

      {@const list = sortMovers(movers(p[by], basis, p.rangeA.days, p.rangeB.days), sort.k, sort.dir)}
      {@const shown = all ? list : list.slice(0, PREVIEW)}
      {@const cols = [
        ["key", by === "projects" ? "Project" : "Model"],
        ["a", rng(p.rangeA)],
        ["b", rng(p.rangeB)],
        ["diff", "Change"],
        ["pct", "%"],
      ] as [MoverSort, string][]}
      <section class="card">
        <div class="bar">
          <h3 class="label nm">What changed, biggest movers</h3>
          <span class="spacer"></span>
          <SegmentedControl
            role="radiogroup"
            size="sm"
            label="Group"
            value={by}
            onChange={(v) => (by = v)}
            options={[
              { id: "projects", label: "By project" },
              { id: "models", label: "By model" },
            ]}
          />
          <SegmentedControl
            role="radiogroup"
            size="sm"
            label="Basis"
            value={basis}
            onChange={(v) => (basis = v)}
            options={[
              { id: "raw", label: "Raw" },
              { id: "day", label: "Per day" },
              { id: "calls", label: "Per 100 calls" },
            ]}
          />
          {#if list.length > PREVIEW}
            <button class="link" type="button" onclick={() => (all = !all)}>
              {all ? `Show top ${PREVIEW}` : `Show all ${list.length}`}
            </button>
          {/if}
        </div>
        {#if list.length === 0}
          <p class="empty">Nothing to compare.</p>
        {:else}
          <div class="scroll">
            <table class="pm">
              <thead>
                <tr>
                  {#each cols as [k, h], i (k)}
                    <th scope="col" class:r={i > 0} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
                      <button type="button" onclick={() => sortBy(k)}>{h}{sort.k === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</button>
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each shown as m (m.key)}
                  <tr>
                    <td class="mono">{m.key}</td>
                    <td class="r">{fmtCost(m.a)}</td>
                    <td class="r">{fmtCost(m.b)}</td>
                    <td class="r"><span class={tone(m.diff)}>{fd(m.diff, fmtCost)}</span></td>
                    <td class="r">
                      {#if m.isNew}<span class="pill">new this period</span>{:else if m.pct === null}—{:else}<span class={tone(m.diff)}>{fp(m.pct)}</span>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        <p class="sub gap">Projects and models split the same difference two ways. Do not add them together.</p>
      </section>

      <section class="card flush">
        <button type="button" class="pp-dis" aria-expanded={det.metrics} onclick={() => (det.metrics = !det.metrics)}>
          <span>{det.metrics ? "⌄" : "›"}</span>All metrics
        </button>
        {#if det.metrics}
          <div class="inner">
            <div class="scroll">
              <table>
                <thead>
                  <tr><th>Metric</th><th class="r">A</th><th class="r">B</th><th class="r">Change</th><th class="r">%</th></tr>
                </thead>
                <tbody>
                  {#each metrics(p) as m (m.n)}
                    <tr>
                      <td>{m.n}</td>
                      <td class="r">{m.f(m.a)}</td>
                      <td class="r">{m.f(m.b)}</td>
                      <td class="r"><span class={m.t ? tone(m.d) : ""}>{fd(m.d, m.f)}</span></td>
                      <td class="r">{m.a ? fp((m.d / m.a) * 100) : "—"}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      </section>
      <section class="card flush">
        <button type="button" class="pp-dis" aria-expanded={det.counted} onclick={() => (det.counted = !det.counted)}>
          <span>{det.counted ? "⌄" : "›"}</span>What is counted
        </button>
        {#if det.counted}
          <div class="inner">
            {#each COUNTED as [t, d] (t)}
              <p class="sub counted"><b>{t}</b> · {d}</p>
            {/each}
          </div>
        {/if}
      </section>
    {/snippet}
  </Loader>
{/if}

<style>
  .card {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    transition: border-color 0.12s;
  }
  .card:hover {
    border-color: var(--border2);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-4);
  }
  .spacer {
    flex: 1;
  }
  .label {
    margin: 0 0 var(--sp-3);
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  .label.nm {
    margin: 0;
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .sub.gap {
    margin-top: var(--sp-3);
  }
  .muted {
    color: var(--muted);
  }
  .btn {
    height: var(--h-sm);
    padding: 0 var(--sp-4);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
  }
  .btn:hover {
    background: var(--surface2);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semi);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  button:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .pp-win {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3) var(--sp-4);
    margin-top: var(--sp-4);
  }
  .pp-k {
    display: inline-flex;
    align-items: center;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .pp-win input {
    height: var(--h-sm);
    max-width: 100%;
    padding: 0 var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-3);
    border-radius: 50%;
    flex-shrink: 0;
  }
  .legend .dot {
    margin: 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .pill.neutral {
    background: var(--surface3);
    color: var(--muted);
  }
  .story {
    margin: 0 0 var(--sp-4);
    font-size: var(--fs-sm);
  }
  .grid {
    display: grid;
    gap: var(--sp-4);
  }
  .g3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @media (max-width: 860px) {
    .g3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 520px) {
    .g3 {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .kpi {
    cursor: default;
  }
  .kpi .k {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .kpi .v {
    margin-top: var(--sp-1);
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    font-weight: var(--fw-semi);
    font-variant-numeric: tabular-nums;
  }
  .kpi .n {
    margin-top: var(--sp-1);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .up {
    color: var(--danger);
  }
  .down {
    color: var(--accent);
  }
  .pp-tw {
    position: relative;
    display: inline-block;
    cursor: help;
  }
  .pp-tt {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: var(--z-popover);
    display: none;
    min-width: 170px;
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--elev-1);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    font-weight: var(--fw-body);
  }
  .pp-tw:hover .pp-tt,
  .pp-tw:focus .pp-tt {
    display: block;
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) 0;
    font-size: var(--fs-xs);
  }
  .kv > :first-child {
    color: var(--muted);
  }
  .kv > :last-child {
    font-family: var(--font-mono);
    font-weight: var(--fw-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-5);
    margin: 0 0 var(--sp-3);
    padding: 0;
    list-style: none;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .chart {
    position: relative;
    width: 100%;
    min-height: 170px;
    padding-top: var(--sp-2);
  }
  .chart svg {
    display: block;
    overflow: visible;
  }
  .chart text {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .tip {
    position: absolute;
    top: 0;
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-1) var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--elev-1);
    font-size: var(--fs-xs);
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .tip .part {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .tip .dot {
    margin: 0 var(--sp-1) 0 0;
  }
  .tip b {
    font-family: var(--font-mono);
    font-weight: var(--fw-semi);
  }
  .chart + .sub {
    margin-top: var(--sp-2);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  th {
    padding: var(--sp-2);
    border-bottom: 1px solid var(--border2);
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    text-align: left;
    white-space: nowrap;
  }
  .pm th {
    font-weight: var(--fw-semi);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .mono {
    font-family: var(--font-mono);
  }
  th button {
    all: unset;
    cursor: pointer;
  }
  th button:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  th[aria-sort] {
    color: var(--text);
  }
  td {
    padding: var(--sp-3) var(--sp-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover {
    background: var(--surface2);
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
  }
  th:last-child,
  td:last-child {
    padding-right: 0;
  }
  .r {
    text-align: right;
  }
  td.r {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
  .flush {
    padding: 0;
    overflow: hidden;
  }
  .pp-dis {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-4) var(--sp-5);
    border: 0;
    background: none;
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: var(--fw-medium);
    text-align: left;
    cursor: pointer;
  }
  .pp-dis:hover {
    background: var(--surface2);
  }
  .inner {
    padding: var(--sp-4) var(--sp-5);
  }
  .counted {
    margin-bottom: var(--sp-3);
  }
  .counted b {
    color: var(--text);
  }
</style>
