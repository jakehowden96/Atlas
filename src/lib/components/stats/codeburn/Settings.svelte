<script lang="ts">
  import type { BudgetStatus } from "../../../../types/codeburn-plans";
  import { codeburnStatus } from "../../../stores/codeburn";
  import CopyButton from "../../ui/CopyButton.svelte";
  import Loader from "./Loader.svelte";

  let { refresh }: { refresh: number } = $props();
  const INSTALL = "npm i -g codeburn";
</script>

<dl>
  <dt>codeburn path</dt><dd>{$codeburnStatus?.binary ?? "—"}</dd>
  <dt>Version</dt><dd>{$codeburnStatus?.version ?? "—"}</dd>
  <Loader args={["status", "--format", "json"]} {refresh}>
    {#snippet children(s: BudgetStatus)}
      <dt>Currency</dt><dd>{s.currency}</dd>
    {/snippet}
  </Loader>
  <dt>Plan</dt><dd>Set it on the Plans tab</dd>
</dl>
<p class="hint">
  Install or update: <code>{INSTALL}</code>
  <CopyButton value={INSTALL} label="Copy install command" size="sm" />
</p>

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--sp-2) var(--sp-4);
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    word-break: break-all;
  }
  .hint {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
