<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    tone?: "error" | "warn";
    id?: string;
    children: Snippet;
  }

  let { tone = "error", id, children }: Props = $props();
</script>

<div class="inline {tone}" {id} role={tone === "error" ? "alert" : "status"}>
  <Icon name={tone === "error" ? "error" : "warning"} />
  <span>{@render children()}</span>
</div>

<style>
  .inline {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    color: var(--danger);
  }
  .warn {
    color: var(--warn);
  }
</style>
