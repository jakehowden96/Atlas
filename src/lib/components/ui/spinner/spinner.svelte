<script lang="ts">
  import { cn } from "$lib/utils.js";
  import Icon from "../icon/icon.svelte";

  // The `progress_activity` glyph, 0.9s. Always sits beside a label, so it is hidden from AT by default.
  let {
    class: className,
    size = 16,
    label,
  }: { class?: string; size?: number; label?: string } = $props();
</script>

<span
  data-slot="icon"
  data-spinner
  role={label ? "status" : undefined}
  class={cn("inline-grid shrink-0 place-items-center text-muted-foreground", className)}
>
  <Icon name="progress_activity" {size} {label} class="animate-spin-atlas" />
</span>
