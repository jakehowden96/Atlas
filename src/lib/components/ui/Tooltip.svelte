<script lang="ts">
  import type { Snippet } from "svelte";
  import { tooltip } from "../../ui/tooltip";
  import type { Align, Side } from "../../ui/floating";

  interface Props {
    text: string;
    shortcut?: string;
    side?: Side;
    align?: Align;
    delay?: number;
    children: Snippet;
  }

  let { text, shortcut, side, align, delay, children }: Props = $props();
</script>

<span class="wrap" use:tooltip={{ text, shortcut, side, align, delay }}>{@render children()}</span>

<style>
  .wrap {
    display: inline-flex;
  }

  /* The bubble is built by the action in a body-level portal, so its styles are global. */
  :global(.atlas-tooltip) {
    position: fixed;
    z-index: var(--z-tooltip);
    max-width: 260px;
    padding: 4px 8px;
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--ink-text);
    box-shadow: var(--elev-1);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    pointer-events: none;
  }
  :global(.atlas-tooltip-kbd) {
    margin-left: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    opacity: 0.8;
  }
</style>
