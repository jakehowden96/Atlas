<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import Icon from "$lib/components/ui/icon/icon.svelte";

  /** shadcn InputGroup with a search glyph; Esc clears, or blurs when already empty. */
  let {
    value = $bindable(""),
    onkeydown,
    class: className,
    ...rest
  }: Omit<HTMLInputAttributes, "value" | "type" | "files" | "size"> & { value?: string } = $props();
  let el: HTMLInputElement | null = $state(null);
</script>

<InputGroup.Root class={className}>
  <InputGroup.Addon><Icon name="search" /></InputGroup.Addon>
  <InputGroup.Input
    {...rest}
    bind:ref={el}
    bind:value
    type="search"
    onkeydown={(e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
      onkeydown?.(e);
      if (e.key !== "Escape") return;
      if (value) {
        value = "";
        e.preventDefault();
        e.stopPropagation();
      } else el?.blur();
    }}
  />
  {#if value}
    <InputGroup.Addon align="inline-end">
      <InputGroup.Button
        size="icon-xs"
        aria-label="Clear search"
        onclick={() => {
          value = "";
          el?.focus();
        }}><Icon name="close" /></InputGroup.Button
      >
    </InputGroup.Addon>
  {/if}
</InputGroup.Root>
