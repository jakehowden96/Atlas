<script lang="ts">
  import { Tooltip as TooltipPrimitive } from "bits-ui";

  // 400ms hover delay; focus opens immediately (bits-ui opens on focus without the delay).
  let { delayDuration = 400, ...restProps }: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider {delayDuration} {...restProps} />
