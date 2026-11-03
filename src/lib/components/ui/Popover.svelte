<script lang="ts">
  import type { Snippet } from "svelte";
  import { placeFloating, type Align, type Side } from "../../ui/floating";

  interface Props {
    open?: boolean;
    /** Element the popover anchors to; focus returns here on close. */
    trigger: HTMLElement | undefined;
    side?: Side;
    align?: Align;
    /** Accessible name, used when the content has controls and the shell becomes a dialog. */
    label?: string;
    children: Snippet;
  }

  let {
    open = $bindable(false),
    trigger,
    side = "bottom",
    align = "start",
    label,
    children,
  }: Props = $props();

  let el = $state<HTMLElement>();
  let hasControls = $state(false);

  const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    if (!open || !el || !trigger) return;
    const node = el;
    const anchor = trigger;
    const first = node.querySelector<HTMLElement>(FOCUSABLE);
    hasControls = !!first;
    first?.focus();
    const stop = placeFloating(anchor, node, { side, align });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!node.contains(t) && !anchor.contains(t)) open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      stop();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      anchor.focus();
    };
  });
</script>

{#if open}
  <div
    bind:this={el}
    use:portal
    class="popover"
    role={hasControls ? "dialog" : undefined}
    aria-label={hasControls ? label : undefined}
  >
    {@render children()}
  </div>
{/if}

<style>
  .popover {
    position: fixed;
    z-index: var(--z-popover);
    padding: 12px;
    border: 1px solid var(--border2);
    border-radius: var(--r-card);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--elev-1);
    font-size: var(--fs-sm);
  }
</style>
