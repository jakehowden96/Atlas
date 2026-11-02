<script lang="ts">
  import Button from "./Button.svelte";
  import IconButton from "./IconButton.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import type { IconName } from "./Icon.svelte";
  import type { Align, Side } from "../../ui/floating";

  interface Props {
    items: MenuItem[];
    onselect?: (item: MenuItem) => void;
    /** Accessible name; also the visible text unless `icon` is set. */
    label: string;
    /** Render an IconButton instead of a text Button. */
    icon?: IconName;
    side?: Side;
    align?: Align;
  }

  let { items, onselect, label, icon, side = "bottom", align = "start" }: Props = $props();

  let open = $state(false);
  let host = $state<HTMLElement>();
  const trigger = $derived(host?.querySelector<HTMLElement>("button") ?? undefined);
</script>

<span class="host" bind:this={host}>
  {#if icon}
    <IconButton {icon} {label} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)} />
  {:else}
    <Button aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>{label}</Button>
  {/if}
</span>
<Menu bind:open {trigger} {items} {onselect} {label} {side} {align} />

<style>
  .host {
    display: inline-flex;
  }
</style>
