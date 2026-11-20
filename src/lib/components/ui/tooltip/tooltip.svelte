<script lang="ts" generics="T = never">
  import { Tooltip as TooltipPrimitive } from "bits-ui";
  import TooltipProvider from "./tooltip-provider.svelte";

  let { open = $bindable(false), ...restProps }: TooltipPrimitive.RootProps<T> = $props();
</script>

<!-- Carries its own Provider (as shadcn's React Tooltip does), so no screen or test needs one above it. -->
<TooltipProvider>
  <TooltipPrimitive.Root bind:open {...restProps} />
</TooltipProvider>
