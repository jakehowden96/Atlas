<script lang="ts">
  import { onDestroy } from "svelte";
  import { copyText } from "../../ui/copy";
  import Button from "./Button.svelte";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  interface Props {
    value: string;
    label?: string;
    variant?: "icon" | "text";
    size?: "sm" | "md" | "lg";
  }

  let { value, label = "Copy", variant = "icon", size = "md" }: Props = $props();

  let status = $state<"idle" | "copied" | "failed">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  const shown = $derived(
    status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy" : label,
  );
  const icon = $derived(status === "copied" ? "check" : "content_copy");

  async function copy() {
    clearTimeout(timer);
    status = (await copyText(value)) ? "copied" : "failed";
    timer = setTimeout(() => (status = "idle"), 2000);
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if variant === "icon"}
  <IconButton {icon} label={shown} {size} onclick={copy} />
{:else}
  <Button {size} onclick={copy}>
    {#snippet leading()}<Icon name={icon} />{/snippet}
    {shown}
  </Button>
{/if}
<span class="sr" aria-live="polite">{status === "idle" ? "" : shown}</span>

<style>
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
