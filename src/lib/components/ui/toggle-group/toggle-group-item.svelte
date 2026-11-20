<script lang="ts">
  import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
  import type { ToggleVariants } from "$lib/components/ui/toggle/index.js";
  import { cn } from "$lib/utils.js";
  import { getToggleGroupCtx } from "./toggle-group.svelte";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    size,
    variant,
    ...restProps
  }: ToggleGroupPrimitive.ItemProps & ToggleVariants = $props();

  const ctx = getToggleGroupCtx();
</script>

<ToggleGroupPrimitive.Item
  bind:ref
  data-slot="toggle-group-item"
  data-variant={ctx.variant || variant}
  data-size={ctx.size || size}
  data-spacing={ctx.spacing}
  class={cn(
    "inline-flex h-[22px] cursor-pointer items-center gap-1.5 rounded-sm px-2.5 whitespace-nowrap text-muted-foreground transition-colors duration-(--dur-instant) hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[inset_0_0_0_1px_var(--input)] group-data-[size=lg]/toggle-group:h-6 group-data-[size=lg]/toggle-group:text-sm disabled:cursor-default",
    className,
  )}
  {value}
  {...restProps}
/>
