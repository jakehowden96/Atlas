<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import Icon from "../icon/icon.svelte";
  import Kbd from "../kbd/kbd.svelte";

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(""),
    escHint = true,
    ...restProps
  }: CommandPrimitive.InputProps & {
    /** Shows an Esc key at the end of the row (palettes close on Esc). */
    escHint?: boolean;
  } = $props();
</script>

<!-- 48px row: search icon, input, Esc. -->
<div
  data-slot="command-input-wrapper"
  class="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3.5 text-muted-foreground"
>
  <Icon name="search" size={18} />
  <CommandPrimitive.Input
    bind:ref
    bind:value
    data-slot="command-input"
    class={cn(
      "h-full min-w-0 flex-1 bg-transparent text-md text-foreground outline-hidden placeholder:text-muted-foreground disabled:cursor-default",
      className,
    )}
    {...restProps}
  />
  {#if escHint}<Kbd>Esc</Kbd>{/if}
</div>
