<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";

  interface Props {
    value?: string[];
    label: string;
    placeholder?: string;
    /** Returns an error message, or null when the value is acceptable. */
    validate?: (value: string) => string | null;
    onChange?: (value: string[]) => void;
  }

  let { value = $bindable([]), label, placeholder, validate, onChange }: Props = $props();

  let draft = $state("");
  let touched = $state(false);
  let error = $state<string | null>(null);
  let announcement = $state("");

  function check(text: string): string | null {
    if (value.includes(text)) return `${text} is already added`;
    return validate?.(text) ?? null;
  }

  // Adds each valid token; the last rejected token's message is kept as the error.
  function add(raw: string) {
    let rejected: string | null = null;
    let rejectedText = "";
    for (const text of raw.split(/[\s,]+/).filter(Boolean)) {
      const err = check(text);
      if (err) {
        rejected = err;
        rejectedText = text;
        continue;
      }
      value = [...value, text];
      announcement = `Added ${text}`;
      onChange?.(value);
    }
    draft = rejected ? rejectedText : "";
    error = rejected;
  }

  function remove(chip: string) {
    value = value.filter((c) => c !== chip);
    announcement = `Removed ${chip}`;
    onChange?.(value);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && draft === "") {
      const last = value[value.length - 1];
      if (last) remove(last);
    }
  }

  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text");
    if (!text || !/[\s,]/.test(text.trim())) return;
    e.preventDefault();
    add(text);
  }

  // Errors show only after the first blur, then update live while typing.
  const shown = $derived(touched ? (draft.trim() ? check(draft.trim()) : error) : null);
</script>

<div class="wrap">
  <div class="field" class:invalid={!!shown}>
    {#each value as chip (chip)}
      <span class="chip">
        <span class="text">{chip}</span>
        <TooltipButton icon="close" label="Remove {chip}" size="sm" onclick={() => remove(chip)} />
      </span>
    {/each}
    <input
      class="input"
      aria-label={label}
      aria-invalid={shown ? true : undefined}
      {placeholder}
      bind:value={draft}
      {onkeydown}
      {onpaste}
      oninput={() => (error = null)}
      onblur={() => (touched = true)}
    />
  </div>
  {#if shown}<Alert.Root variant="destructive" layout="inline"><Icon name="error" /><Alert.Title>{shown}</Alert.Title></Alert.Root>{/if}
  <span class="sr" aria-live="polite">{announcement}</span>
</div>

<style>
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--card);
  }
  .field:hover {
    border-color: var(--muted-foreground);
  }
  .field:focus-within {
    border-color: var(--foreground);
  }
  .field.invalid {
    border-color: var(--destructive);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding-left: var(--sp-2);
    border-radius: var(--radius-md);
    background: var(--muted);
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }
  .input {
    flex: 1;
    min-width: 8ch;
    height: var(--h-sm);
    border: 0;
    background: transparent;
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .wrap {
    position: relative;
  }
</style>
