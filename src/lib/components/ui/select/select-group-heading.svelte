<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: ComponentProps<typeof SelectPrimitive.GroupHeading> = $props();
</script>

<SelectPrimitive.GroupHeading
  bind:ref
  data-slot="select-group-heading"
  class={cn(
    "px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-[0.06em] uppercase text-muted-foreground data-inset:pl-[34px]",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</SelectPrimitive.GroupHeading>
