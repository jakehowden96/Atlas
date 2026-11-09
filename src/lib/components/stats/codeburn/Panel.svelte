<script lang="ts">
  import type { Snippet } from "svelte";
  import Card from "./Card.svelte";

  interface Props {
    title: string;
    /** Muted caption beside the title. */
    note?: string | Snippet;
    /** Shows "No data" instead of the body. */
    empty?: boolean;
    children: Snippet;
  }

  let { title, note, empty = false, children }: Props = $props();
</script>

<Card {title} {note}>
  {#if empty}
    <p class="empty">No data</p>
  {:else}
    {@render children()}
  {/if}
</Card>

<style>
  .empty {
    margin: 0;
    padding: var(--sp-5) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
