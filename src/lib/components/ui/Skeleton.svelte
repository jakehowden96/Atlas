<script lang="ts">
  import type { Snippet } from "svelte";
  import { delayedFlag } from "../../ui/delay";

  interface Props {
    /** Any CSS length, e.g. "var(--sp-9)" or "60%". */
    width?: string;
    height?: string;
    /** Radius token name without the `--r-` prefix. */
    radius?: "xs" | "sm" | "md" | "lg" | "card" | "card-lg" | "modal" | "pill";
    /** Show nothing until loading has lasted this many ms. */
    delay?: number;
    /** When given, they are wrapped in a region marked aria-busy. */
    children?: Snippet;
  }

  let {
    width = "100%",
    height = "var(--sp-4)",
    radius = "sm",
    delay = 0,
    children,
  }: Props = $props();
  let visible = $state(false);

  $effect(() => {
    const f = delayedFlag((v) => (visible = v), delay);
    f.set(true);
    return () => f.destroy();
  });
</script>

{#if visible}
  {#if children}
    <div aria-busy="true">{@render children()}</div>
  {:else}
    <div class="block" style:width style:height style:border-radius={`var(--r-${radius})`}></div>
  {/if}
{/if}

<style>
  .block {
    background: var(--surface3);
    animation: var(--pulse);
  }
</style>
