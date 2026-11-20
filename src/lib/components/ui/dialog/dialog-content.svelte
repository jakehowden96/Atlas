<script lang="ts" module>
  /** sm 420 · default 560 · lg 720, never wider than the window less a 16px gutter. */
  export const dialogWidths = {
    sm: "w-[min(420px,calc(100vw-2rem))]",
    default: "w-[min(560px,calc(100vw-2rem))]",
    lg: "w-[min(720px,calc(100vw-2rem))]",
  } as const;
  export type DialogSize = keyof typeof dialogWidths;

  /** Popover ground, input outline, xl radius, elev-2; header / scrolling body / footer. */
  export const dialogSurface =
    "flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl border border-input bg-popover text-sm text-popover-foreground shadow-elev-2 outline-none";
</script>

<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import DialogOverlay from "./dialog-overlay.svelte";
  import DialogPortal from "./dialog-portal.svelte";
  import type { Snippet } from "svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    size = "default",
    children,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
    size?: DialogSize;
    children: Snippet;
  } = $props();
</script>

<DialogPortal {...portalProps}>
  <DialogOverlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    data-size={size}
    class={cn(
      dialogSurface,
      dialogWidths[size],
      "fixed top-1/2 left-1/2 z-(--z-overlay) -translate-x-1/2 -translate-y-1/2 duration-(--dur-base) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </DialogPrimitive.Content>
</DialogPortal>
