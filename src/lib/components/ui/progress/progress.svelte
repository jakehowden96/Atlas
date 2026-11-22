<script lang="ts">
  import { Progress as ProgressPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    indicatorClass,
    max = 100,
    value,
    ...restProps
  }: WithoutChildrenOrChild<ProgressPrimitive.RootProps> & {
    /** e.g. `bg-warning` for context above 75%. */
    indicatorClass?: string;
  } = $props();
</script>

<!-- 2px, accent track, success indicator. -->
<ProgressPrimitive.Root
  bind:ref
  data-slot="progress"
  class={cn("relative block h-0.5 w-full overflow-hidden bg-accent", className)}
  {value}
  {max}
  {...restProps}
>
  <div
    data-slot="progress-indicator"
    class={cn("h-full bg-success transition-[width] duration-(--dur-base)", indicatorClass)}
    style:width="{(100 * (value ?? 0)) / (max || 1)}%"
  ></div>
</ProgressPrimitive.Root>
