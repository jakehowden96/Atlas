<script lang="ts">
  import type { BudgetStatus } from "../../../../types/codeburn-plans";
  import { setTheme } from "../../../stores/settings";
  import { codeburnStatus } from "../../../stores/codeburn";
  import { themeMode, type ThemeMode } from "../../../theme";
  import CopyButton from "../../app/common/CopyButton.svelte";
  import Segmented, { type Segment } from "$lib/components/app/common/Segmented.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";

  let { refresh }: { refresh: number } = $props();
  const INSTALL = "npm i -g codeburn";
  const APPEARANCE: Segment<ThemeMode>[] = [
    { id: "system", label: "Auto" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
</script>

<div class="page">
  <Card title="Appearance">
    <div class="bar">
      <span class="sub">Theme</span>
      <Segmented
        options={APPEARANCE}
        value={$themeMode}
        size="sm"
        role="radiogroup"
        label="Theme"
        onChange={(id) => void setTheme(id)}
      />
    </div>
  </Card>

  <Card title="About">
    <div class="kv">
      <span>codeburn path</span><span class="path">{$codeburnStatus?.binary ?? "—"}</span>
    </div>
    <div class="kv"><span>Version</span><span>{$codeburnStatus?.version ?? "—"}</span></div>
    <Loader args={["status", "--format", "json"]} {refresh}>
      {#snippet children(s: BudgetStatus)}
        <div class="kv"><span>Currency</span><span>{s.currency}</span></div>
      {/snippet}
    </Loader>
    <div class="kv"><span>Plan</span><span>Set it on the Plans tab</span></div>
    <div class="kv">
      <span>Install or update</span>
      <span
        ><code>{INSTALL}</code>
        <CopyButton value={INSTALL} label="Copy install command" size="sm" /></span
      >
    </div>
  </Card>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-4);
  }
  .sub {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) 0;
    font-size: var(--text-caption);
  }
  .kv > :first-child {
    color: var(--muted-foreground);
  }
  .kv > :last-child {
    font-family: var(--font-mono);
    font-weight: var(--font-weight-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .kv .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--foreground);
    font-weight: var(--font-weight-normal);
  }
  code {
    font-family: var(--font-mono);
  }
</style>
