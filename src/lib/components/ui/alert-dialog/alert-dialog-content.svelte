<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { cn, type WithoutChild, type WithoutChildrenOrChild } from "$lib/utils.js";
  import { dialogSurface, dialogWidths } from "../dialog/dialog-content.svelte";
  import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
  import AlertDialogPortal from "./alert-dialog-portal.svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    size = "default",
    portalProps,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.ContentProps> & {
    size?: "default" | "sm";
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>;
  } = $props();
</script>

<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay />
  <AlertDialogPrimitive.Content
    bind:ref
    data-slot="alert-dialog-content"
    data-size={size}
    class={cn(
      "group/alert-dialog-content fixed top-1/2 left-1/2 z-(--z-overlay) -translate-x-1/2 -translate-y-1/2 duration-(--dur-base) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      dialogSurface,
      dialogWidths[size],
      className,
    )}
    {...restProps}
  />
</AlertDialogPortal>
