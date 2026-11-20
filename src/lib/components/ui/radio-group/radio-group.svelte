<script lang="ts">
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(""),
    orientation = "vertical",
    ...restProps
  }: RadioGroupPrimitive.RootProps = $props();
</script>

<RadioGroupPrimitive.Root
  bind:ref
  bind:value
  {orientation}
  data-slot="radio-group"
  class={cn("flex gap-3.5 data-[orientation=vertical]:flex-col data-[orientation=vertical]:gap-2", className)}
  {...restProps}
/>
