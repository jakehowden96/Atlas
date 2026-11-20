<script lang="ts">
  import { cn } from "$lib/utils.js";
  import Icon from "../icon/icon.svelte";

  let {
    saved = false,
    class: className,
  }: {
    /** Set true after a blur-commit; the tick shows for 2 seconds. */
    saved?: boolean;
    class?: string;
  } = $props();

  let show = $state(false);
  $effect(() => {
    if (!saved) return;
    show = true;
    const t = setTimeout(() => (show = false), 2000);
    return () => clearTimeout(t);
  });
</script>

<span
  data-slot="field-saved"
  aria-live="polite"
  class={cn("ml-auto inline-flex items-center gap-1 text-xs text-success", className)}
>
  {#if show}<Icon name="check" size={14} /> Saved{/if}
</span>
