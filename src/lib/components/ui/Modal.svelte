<script module lang="ts">
  /**
   * Delay a state change so an exit animation can finish before unmount.
   *
   * Every modal, drawer and rail in Mission Control closes this way: flip the
   * closing flag, paint the exit keyframes, and only then clear the state that
   * unmounts the node. Clearing it immediately makes the exit frame flicker.
   */
  export function closeWith(after: () => void, ms = 200): void {
    setTimeout(after, ms);
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    /** Called on overlay click. Set the owning store false from here. */
    onClose: () => void;
    /** Panel width; anything CSS accepts. */
    width?: string;
    /** "center" for Settings, "top" for the New Session command palette. */
    align?: "center" | "top";
    children: Snippet;
  }

  let { open, onClose, width = "640px", align = "center", children }: Props = $props();

  const EXIT_MS = 180;

  // `visible` lags `open` by the exit animation so the panel can sink out
  // before it leaves the DOM. See closeWith above.
  let visible = $state(false);
  let closing = $state(false);

  $effect(() => {
    if (open) {
      visible = true;
      closing = false;
    } else if (visible && !closing) {
      closing = true;
      closeWith(() => {
        visible = false;
        closing = false;
      }, EXIT_MS);
    }
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" class:closing class:top={align === "top"} onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="panel"
      class:closing
      style="width: {width}"
      onclick={(e) => e.stopPropagation()}
    >
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--overlay);
    animation: atlasFadeIn 0.16s ease;
  }

  .overlay.top {
    align-items: flex-start;
    padding-top: 80px;
  }

  .overlay.closing {
    animation: atlasFadeOut 0.18s ease both;
  }

  .panel {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 96px);
    overflow: hidden;
    border: 1px solid var(--border2);
    border-radius: var(--r-modal);
    background: var(--surface);
    box-shadow: var(--shadow);
    animation: atlasRise 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .panel.closing {
    animation: atlasSink 0.18s ease both;
  }
</style>
