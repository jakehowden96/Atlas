<script lang="ts">
  import Icon from "./Icon.svelte";
  import { delayedFlag } from "../../ui/delay";

  interface Props {
    /** Announced text; always present, shown unless `hideLabel`. */
    label: string;
    hideLabel?: boolean;
    /** Show nothing until loading has lasted this many ms. */
    delay?: number;
  }

  let { label, hideLabel = false, delay = 0 }: Props = $props();
  let visible = $state(false);

  $effect(() => {
    const f = delayedFlag((v) => (visible = v), delay);
    f.set(true);
    return () => f.destroy();
  });
</script>

{#if visible}
  <span class="spinner" role="status">
    <span class="spin"><Icon name="progress_activity" /></span>
    <span class:sr={hideLabel}>{label}</span>
  </span>
{/if}

<style>
  .spinner {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .spin {
    display: inline-flex;
    animation: atlasSpin 0.9s linear infinite;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
