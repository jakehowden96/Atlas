<script module lang="ts">
  /**
   * Delay a state change so an exit animation can finish before unmount.
   *
   * Every modal, drawer and rail in Mission Control closes this way: flip the
   * closing flag, paint the exit keyframes, and only then clear the state that
   * unmounts the node. Clearing it immediately makes the exit frame flicker.
   */
  export function closeWith(after: () => void, ms = 200): ReturnType<typeof setTimeout> {
    return setTimeout(after, ms);
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
    /** "center" for Settings, "top" for the New Session command palette,
     *  "right" for the Drawer (full-height panel sliding in from the edge). */
    align?: "center" | "top" | "right";
    /** Renders the 44px header and names the dialog. */
    title?: string;
    /** id of a heading the consumer renders itself. */
    labelledBy?: string;
    /** Plain accessible name for consumers with no visible heading. */
    ariaLabel?: string;
    /** Pinned footer, right-aligned: secondary action first, primary last. */
    footer?: Snippet;
    children: Snippet;
  }

  let {
    open,
    onClose,
    width = "640px",
    align = "center",
    title,
    labelledBy,
    ariaLabel,
    footer,
    children,
  }: Props = $props();

  const titleId = `modal-title-${Math.random().toString(36).slice(2)}`;
  const named = $derived(title ? titleId : labelledBy);

  $effect(() => {
    if (import.meta.env.DEV && open && !title && !labelledBy && !ariaLabel) {
      console.warn("Modal: dialog has no accessible name; pass title, labelledBy or ariaLabel");
    }
  });

  const EXIT_MS = 180;

  // `visible` lags `open` by the exit animation so the panel can sink out
  // before it leaves the DOM. See closeWith above.
  let visible = $state(false);
  let closing = $state(false);

  let panelEl = $state<HTMLDivElement | null>(null);
  /** Whatever had focus when the modal opened, so closing can hand it back. */
  let restoreTo: HTMLElement | null = null;
  /** The pending unmount. A reopen inside the exit window must cancel it, or it
   *  would fire later and hide a modal that is meant to be open. */
  let exitTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (open) {
      clearTimeout(exitTimer);
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
      exitTimer = closeWith(() => {
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
    // A consumer that already handled Esc (clearing a filter, say) marks it
    // defaultPrevented; honour that so the key never acts twice.
    if (e.key === "Escape" && !e.defaultPrevented && !closing) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = tabbables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      panelEl?.focus();
      return;
    }
    const edge = e.shiftKey ? first : last;
    const wrapTo = e.shiftKey ? last : first;
    const active = document.activeElement;
    if (active !== edge && panelEl?.contains(active)) return;
    e.preventDefault();
    wrapTo.focus();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" class:closing class:top={align === "top"} class:right={align === "right"} onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={panelEl}
      class="panel"
      class:closing
      class:right={align === "right"}
      style="width: {width}"
      role="dialog"
      aria-modal="true"
      aria-labelledby={named}
      aria-label={named ? undefined : ariaLabel}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      {#if title}
        <header class="head"><h2 id={titleId}>{title}</h2></header>
      {/if}
      <div class="body">{@render children()}</div>
      {#if footer}
        <footer class="foot">{@render footer()}</footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
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

  .overlay.right {
    z-index: var(--z-drawer);
    justify-content: flex-end;
  }

  .overlay.closing {
    animation: atlasFadeOut 0.18s ease both;
  }

  .panel {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border2);
    border-radius: var(--r-modal);
    background: var(--surface);
    box-shadow: var(--elev-2);
    animation: atlasRise 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
    /* New Session animates 640↔960px when it switches Fresh↔Resume. Every
       other modal has a constant width, so this is inert for them. */
    transition: width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .panel.closing {
    animation: atlasSink 0.18s ease both;
  }

  .panel.right {
    max-height: none;
    height: 100%;
    border-width: 0 0 0 1px;
    border-radius: 0;
    animation: modalSlideIn var(--dur-slow) var(--ease-out);
  }

  .panel.right.closing {
    animation: atlasSink 0.18s ease both;
  }

  @keyframes modalSlideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: none;
    }
  }

  /* Header and footer stay put; only the body scrolls, so a tall dialog
     never clips at the 500px minimum window height. */
  .head {
    flex: none;
    display: flex;
    align-items: center;
    height: var(--h-bar);
    padding: 0 var(--sp-5);
    border-bottom: 1px solid var(--border);
  }

  .head h2 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: var(--fw-semi);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }

  .foot {
    flex: none;
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5);
    border-top: 1px solid var(--border);
  }
</style>
