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

  let panelEl = $state<HTMLDivElement | null>(null);
  /** Whatever had focus when the modal opened, so closing can hand it back. */
  let restoreTo: HTMLElement | null = null;

  $effect(() => {
    if (open) {
      if (!visible) restoreTo = document.activeElement as HTMLElement | null;
      visible = true;
      closing = false;
    } else if (visible && !closing) {
      closing = true;
      // Focus goes back before the exit run rather than after it: the node the
      // ring lands on has to be on screen while the panel is still sinking.
      const back = restoreTo;
      restoreTo = null;
      if (back?.isConnected) back.focus();
      closeWith(() => {
        visible = false;
        closing = false;
      }, EXIT_MS);
    }
  });

  /* Anything the browser would tab to. `:not([tabindex="-1"])` keeps the panel
     itself out — it only carries a tabindex so it can be the fallback below. */
  const FOCUSABLE =
    'a[href], a[tabindex="0"], button:not([disabled]), input:not([disabled]),' +
    ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function tabbables(): HTMLElement[] {
    return [...(panelEl?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
    );
  }

  /* Pull focus in one turn after mounting, and only if nothing inside has it
     already — both palettes focus their own filter box from an effect of their
     own, and this must not fight them for it. */
  $effect(() => {
    if (!visible || closing || !panelEl) return;
    const timer = setTimeout(() => {
      if (!panelEl || panelEl.contains(document.activeElement)) return;
      (tabbables()[0] ?? panelEl).focus();
    });
    return () => clearTimeout(timer);
  });

  /**
   * Trap ⇥ inside the panel. Without this the tab order walks straight out of
   * an open modal into the screen behind it, which is unreachable by pointer
   * and so reads as focus simply vanishing.
   */
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = tabbables();
    if (items.length === 0) {
      e.preventDefault();
      panelEl?.focus();
      return;
    }
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    const wrapTo = e.shiftKey ? items[items.length - 1] : items[0];
    const active = document.activeElement;
    if (active !== edge && panelEl?.contains(active)) return;
    e.preventDefault();
    wrapTo.focus();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" class:closing class:top={align === "top"} onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={panelEl}
      class="panel"
      class:closing
      style="width: {width}"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
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
    /* New Session animates 640↔860px when it switches Fresh↔Resume. Every
       other modal has a constant width, so this is inert for them. */
    transition: width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .panel.closing {
    animation: atlasSink 0.18s ease both;
  }
</style>
