<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";
  import Button from "../button/button.svelte";
  import Icon from "../icon/icon.svelte";

  let {
    ref = $bindable(null),
    class: className,
    showCloseButton = true,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & { showCloseButton?: boolean } = $props();
</script>

<!-- 44px bar: title (15 semibold) and a ghost icon close. Also used by Sheet. -->
<div
  bind:this={ref}
  data-slot="dialog-header"
  class={cn(
    "flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4 *:data-[slot=dialog-title]:flex-1",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  {#if showCloseButton}
    <DialogPrimitive.Close data-slot="dialog-close">
      {#snippet child({ props })}
        <Button variant="ghost" size="icon" aria-label="Close" {...props}>
          <Icon name="close" size={18} />
        </Button>
      {/snippet}
    </DialogPrimitive.Close>
  {/if}
</div>
