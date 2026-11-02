<script lang="ts">
  interface Props {
    count: number;
    /** Alert count: warn ring and text instead of the neutral fill. */
    alert?: boolean;
  }

  let { count, alert = false }: Props = $props();
</script>

<span class="badge" class:alert>{count}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--h-2xs);
    height: var(--h-2xs);
    padding: 0 var(--sp-2);
    border-radius: var(--r-pill);
    background: var(--surface3);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semi);
  }

  .badge.alert {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--warn);
    color: var(--warn);
  }
</style>
