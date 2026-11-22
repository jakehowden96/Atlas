<script lang="ts" module>
  export type Side = "right" | "left";
</script>

<script lang="ts">
  import { Dialog as SheetPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import SheetOverlay from "./sheet-overlay.svelte";
  import SheetPortal from "./sheet-portal.svelte";
  import type { Snippet } from "svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    side = "right",
    portalProps,
    children,
    ...restProps
  }: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
    side?: Side;
    children: Snippet;
  } = $props();
</script>

<!-- Full height from the right, over --dur-slow. 44px header / scrolling body / footer. -->
<SheetPortal {...portalProps}>
  <SheetOverlay />
  <SheetPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    data-side={side}
    class={cn(
      "fixed inset-y-0 z-(--z-overlay) flex w-[min(560px,calc(100vw-3rem))] flex-col overflow-hidden border-input bg-popover text-sm text-popover-foreground shadow-elev-2 outline-none duration-(--dur-slow) ease-(--ease-out)",
      "data-[side=right]:right-0 data-[side=right]:border-l data-[side=left]:left-0 data-[side=left]:border-r",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[side=right]:data-[state=open]:slide-in-from-right data-[side=right]:data-[state=closed]:slide-out-to-right data-[side=left]:data-[state=open]:slide-in-from-left data-[side=left]:data-[state=closed]:slide-out-to-left",
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </SheetPrimitive.Content>
</SheetPortal>
