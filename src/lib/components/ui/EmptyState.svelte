<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  interface Props {
    icon: IconName;
    title: string;
    /** One sentence, no trailing period. Ignored by `compact`. */
    description?: string;
    /** One line with an icon and the title, for tree sections and rail tiles. */
    compact?: boolean;
    action?: Snippet;
  }

  let { icon, title, description, compact = false, action }: Props = $props();
</script>

{#if compact}
  <p class="compact"><Icon name={icon} />{title}</p>
{:else}
  <div class="empty">
    <span class="disc"><Icon name={icon} size={18} /></span>
    <p class="title">{title}</p>
    {#if description}<p class="desc">{description}</p>{/if}
    {#if action}<div class="action">{@render action()}</div>{/if}
  </div>
{/if}

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--sp-3);
    padding: var(--sp-8) var(--sp-5);
  }
  .disc {
    display: grid;
    place-items: center;
    width: var(--h-xl);
    height: var(--h-xl);
    border-radius: var(--r-pill);
    background: var(--surface2);
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .title {
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  .desc {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .action {
    margin-top: var(--sp-2);
  }
  .compact {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
