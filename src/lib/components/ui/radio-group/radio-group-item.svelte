<script lang="ts">
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
  bind:ref
  data-slot="radio-group-item"
  class={cn(
    "peer relative inline-grid aspect-square size-4 shrink-0 cursor-pointer place-items-center rounded-full border-[1.5px] border-input bg-card",
    "data-[state=checked]:border-primary aria-invalid:border-destructive disabled:cursor-default disabled:border-border disabled:bg-muted",
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked })}
    {#if checked}
      <span
        data-slot="radio-group-indicator"
        class="size-[7px] rounded-full bg-primary in-disabled:bg-muted-foreground"
      ></span>
    {/if}
  {/snippet}
</RadioGroupPrimitive.Item>
