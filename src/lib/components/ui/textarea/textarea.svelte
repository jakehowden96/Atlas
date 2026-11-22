<script lang="ts">
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { controlClasses } from "../input/input.svelte";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    counter = false,
    "data-slot": dataSlot = "textarea",
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> & {
    /** Shows `length / maxlength` under the field. */
    counter?: boolean;
  } = $props();
</script>

{#if counter}
  <div class="grid gap-1">
    <textarea
      bind:this={ref}
      data-slot={dataSlot}
      class={cn(controlClasses, "block min-h-[72px] px-2.5 py-[7px] leading-5", className)}
      bind:value
      {...restProps}
    ></textarea>
    <span class="justify-self-end font-mono text-xs text-muted-foreground tabular-nums">
      {String(value ?? "").length}{restProps.maxlength ? ` / ${restProps.maxlength}` : ""}
    </span>
  </div>
{:else}
  <textarea
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(controlClasses, "block min-h-[72px] px-2.5 py-[7px] leading-5", className)}
    bind:value
    {...restProps}
  ></textarea>
{/if}
