<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Render for use inside an ink (inverted) button. */
    onInk?: boolean;
    children: Snippet;
  }

  let { onInk = false, children }: Props = $props();
</script>

<kbd class="kbd" class:on-ink={onInk}>{@render children()}</kbd>

<style>
  .kbd {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-2);
    box-sizing: border-box;
    border: 1px solid var(--border2);
    border-bottom-width: 2px;
    border-radius: var(--r-xs);
    background: var(--surface);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1;
  }

  .kbd.on-ink {
    background: transparent;
    border-color: color-mix(in srgb, var(--ink-text) 70%, transparent);
    color: color-mix(in srgb, var(--ink-text) 70%, transparent);
  }
</style>
