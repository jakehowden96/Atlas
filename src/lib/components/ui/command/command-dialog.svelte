<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import Command from "./command.svelte";
  import type { Command as CommandPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    ref = $bindable(null),
    value = $bindable(""),
    title = "Command palette",
    description = "Search for a command to run",
    portalProps,
    children,
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.RootProps> &
    WithoutChildrenOrChild<CommandPrimitive.RootProps> & {
      portalProps?: DialogPrimitive.PortalProps;
      children: Snippet;
      title?: string;
      description?: string;
      class?: string;
    } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class={cn("top-[15vh] translate-y-0", className)} {portalProps}>
    <DialogPrimitive.Title class="sr-only">{title}</DialogPrimitive.Title>
    <DialogPrimitive.Description class="sr-only">{description}</DialogPrimitive.Description>
    <Command {...restProps} bind:value bind:ref {children} />
  </Dialog.Content>
</Dialog.Root>
