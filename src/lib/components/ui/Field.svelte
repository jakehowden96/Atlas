<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  export interface FieldControlProps {
    id: string;
    "aria-describedby": string | undefined;
    "aria-required": true | undefined;
    invalid: boolean;
  }

  interface Props {
    label: string;
    help?: string;
    error?: string;
    required?: boolean;
    optional?: boolean;
    /** Set true after a commit; the tick shows for 2 seconds. */
    saved?: boolean;
    children: Snippet<[FieldControlProps]>;
  }

  let { label, help, error, required, optional, saved = false, children }: Props = $props();

  const uid = $props.id();
  const id = `${uid}-control`;
  const helpId = `${uid}-help`;
  const errorId = `${uid}-error`;

  let showSaved = $state(false);
  $effect(() => {
    if (!saved) return;
    showSaved = true;
    const t = setTimeout(() => (showSaved = false), 2000);
    return () => clearTimeout(t);
  });

  // aria-invalid is set by the control from `invalid`.
  const controlProps = $derived<FieldControlProps>({
    id,
    "aria-describedby": error ? errorId : help ? helpId : undefined,
    "aria-required": required ? true : undefined,
    invalid: !!error,
  });
</script>

<div class="field">
  <div class="head">
    <label for={id}>{label}</label>
    {#if required}<span class="marker">Required</span>{/if}
    {#if optional && !required}<span class="marker">Optional</span>{/if}
    <span class="saved" aria-live="polite">
      {#if showSaved}<Icon name="check" /> Saved{/if}
    </span>
  </div>
  {@render children(controlProps)}
  {#if error}
    <p class="msg err" id={errorId}><Icon name="error" /> {error}</p>
  {:else if help}
    <p class="msg" id={helpId}>{help}</p>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
  }
  label {
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    color: var(--text);
  }
  .marker {
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
  .saved {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    font-size: var(--fs-2xs);
    color: var(--accent);
  }
  .msg {
    margin: 0;
    font-size: var(--fs-2xs);
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .msg.err {
    color: var(--danger);
  }
</style>
