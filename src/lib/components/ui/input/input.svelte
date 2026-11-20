<script lang="ts" module>
  // Shared by Input, Textarea, Select trigger and InputGroup: 28px, card ground, input outline.
  // Focus: foreground border + the global ring at 1px offset. Invalid: destructive border.
  export const controlClasses =
    "w-full min-w-0 rounded-md border border-input bg-card text-sm text-foreground transition-colors duration-(--dur-instant) placeholder:text-muted-foreground focus-visible:border-foreground aria-invalid:border-destructive disabled:cursor-default disabled:border-border disabled:bg-muted disabled:text-muted-foreground";
</script>

<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";

  type InputType = Exclude<HTMLInputTypeAttribute, "file">;

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type" | "size"> &
      ({ type: "file"; files?: FileList | null } | { type?: InputType; files?: undefined }) & {
        /** `lg` (40px) is the palette input. */
        size?: "default" | "lg";
        mono?: boolean;
      }
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    type,
    files = $bindable(),
    class: className,
    size = "default",
    mono = false,
    "data-slot": dataSlot = "input",
    ...restProps
  }: Props = $props();

  const cls = $derived(
    cn(
      controlClasses,
      "h-7 px-2.5",
      size === "lg" && "h-10 text-md",
      mono && "font-mono text-caption",
      className,
    ),
  );
</script>

{#if type === "file"}
  <input bind:this={ref} data-slot={dataSlot} class={cls} type="file" bind:files bind:value {...restProps} />
{:else}
  <input bind:this={ref} data-slot={dataSlot} class={cls} {type} bind:value {...restProps} />
{/if}
