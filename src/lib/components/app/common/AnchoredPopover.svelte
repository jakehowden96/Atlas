<script lang="ts">
  /**
   * shadcn Popover anchored to a caller-owned trigger element (the caller toggles `open`).
   * Clicks on the trigger don't count as outside, so its own toggle wins; focus returns to it on close.
   */
  import type { Snippet } from "svelte";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { cn } from "$lib/utils.js";

  let {
    open = $bindable(false),
    trigger,
    side = "bottom",
    align = "start",
    label,
    attached = false,
    children,
  }: {
    open?: boolean;
    trigger: HTMLElement | null | undefined;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    /** Accessible name of the dialog. */
    label?: string;
    /** Hangs flush off the trigger's bottom edge as a sheet: no gap, top border or top radius. */
    attached?: boolean;
    children: Snippet;
  } = $props();
</script>

<Popover.Root bind:open>
  <Popover.Content
    customAnchor={trigger}
    {side}
    {align}
    sideOffset={attached ? 0 : 4}
    role="dialog"
    aria-label={label}
    class={cn("w-auto", attached && "overflow-hidden rounded-t-none border-t-0 p-0")}
    onInteractOutside={(e) => {
      if (trigger?.contains(e.target as Node)) e.preventDefault();
    }}
    onCloseAutoFocus={(e) => {
      e.preventDefault();
      trigger?.focus();
    }}
  >
    {@render children()}
  </Popover.Content>
</Popover.Root>
