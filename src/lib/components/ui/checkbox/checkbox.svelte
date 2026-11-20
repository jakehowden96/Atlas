<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import Icon from "../icon/icon.svelte";

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  data-slot="checkbox"
  class={cn(
    "peer relative inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-xs border-[1.5px] border-input bg-card text-primary-foreground",
    "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
    "aria-invalid:border-destructive disabled:cursor-default disabled:border-border disabled:bg-muted data-[state=checked]:disabled:bg-muted-foreground data-[state=checked]:disabled:border-muted-foreground",
    className,
  )}
  bind:checked
  bind:indeterminate
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    {#if indeterminate}
      <Icon name="remove" size={14} />
    {:else if checked}
      <Icon name="check" size={14} />
    {/if}
  {/snippet}
</CheckboxPrimitive.Root>
