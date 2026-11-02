<script lang="ts">
  import Radio from "./Radio.svelte";

  interface Option {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }
  interface Props {
    options: Option[];
    value?: string;
    name?: string;
    label?: string;
  }

  let { options, value = $bindable(), name, label }: Props = $props();

  let group = $state<HTMLElement>();
  const enabled = $derived(options.filter((o) => !o.disabled));
  // Roving tabindex: the checked option, else the first enabled one.
  const stop = $derived(enabled.find((o) => o.value === value) ?? enabled[0]);

  function onkeydown(e: KeyboardEvent) {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step || !enabled.length) return;
    e.preventDefault();
    const cur = (document.activeElement as HTMLElement | null)?.dataset.value;
    const i = enabled.findIndex((o) => o.value === cur);
    const next = enabled[(i + step + enabled.length) % enabled.length]!;
    value = next.value;
    group?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div bind:this={group} class="group" role="radiogroup" aria-label={label} {onkeydown}>
  {#each options as o (o.value)}
    <Radio
      checked={o.value === value}
      label={o.label}
      description={o.description}
      disabled={o.disabled}
      value={o.value}
      tabindex={o === stop ? 0 : -1}
      onSelect={() => (value = o.value)}
    />
  {/each}
  {#if name}<input type="hidden" {name} value={value ?? ""} />{/if}
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
