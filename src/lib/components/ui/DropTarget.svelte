<script lang="ts">
  import { onMount } from "svelte";
  import { dragState, dropHint, startDropListener, type DragState } from "../../drop";
  import Icon from "./Icon.svelte";

  interface Props {
    /** Static state for the gallery; when set the window listener is not started. */
    state?: DragState;
  }

  let { state: forced }: Props = $props();

  const current = $derived(forced ?? $dragState);
  const over = $derived(current.kind === "over");
  const rejecting = $derived(current.kind === "over" && current.folders === 0);

  onMount(() => {
    if (forced) return;
    let stop: (() => void) | undefined;
    let gone = false;
    startDropListener()
      .then((fn) => {
        if (gone) fn();
        else stop = fn;
      })
      .catch(() => {});
    return () => {
      gone = true;
      stop?.();
    };
  });
</script>

<div class="drop" class:over class:rejecting aria-hidden={over ? undefined : "true"}>
  {#if over}
    <div class="card" role="status">
      <Icon name="folder" size={18} />
      <p class="title">Drop to add as a workspace</p>
      <p class="hint">{dropHint(current)}</p>
    </div>
  {/if}
</div>

<style>
  .drop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: none;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    background: var(--bg);
    opacity: 0.92;
  }
  .drop.over {
    display: flex;
  }
  .card {
    position: absolute;
    inset: var(--sp-5);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    border: 2px dashed var(--accent);
    border-radius: var(--r-modal);
    color: var(--text);
  }
  .rejecting .card {
    border-color: var(--muted);
  }
  p {
    margin: 0;
  }
  .title {
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .hint {
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
