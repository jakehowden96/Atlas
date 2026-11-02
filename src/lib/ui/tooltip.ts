import { placeFloating, type Align, type Side } from "./floating";

export interface TooltipOptions {
  text: string;
  shortcut?: string;
  side?: Side;
  align?: Align;
  /** Hover delay in ms; focus always opens immediately. Charts pass 0. */
  delay?: number;
}

let seq = 0;

/** Replacement for `title=`: `use:tooltip={{ text, shortcut }}`. The bubble lives in a body-level portal. */
export function tooltip(node: HTMLElement, initial: TooltipOptions) {
  let opts = initial;
  const id = `tooltip-${++seq}`;
  let bubble: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") hide();
  };

  function show() {
    clearTimeout(timer);
    if (bubble || !opts.text) return;
    bubble = document.createElement("div");
    bubble.id = id;
    bubble.className = "atlas-tooltip";
    bubble.setAttribute("role", "tooltip");
    bubble.textContent = opts.text;
    if (opts.shortcut) {
      const k = document.createElement("kbd");
      k.className = "atlas-tooltip-kbd";
      k.textContent = opts.shortcut;
      bubble.append(k);
    }
    document.body.append(bubble);
    node.setAttribute("aria-describedby", id);
    stop = placeFloating(node, bubble, { side: opts.side, align: opts.align });
    document.addEventListener("keydown", onKey);
  }

  function hide() {
    clearTimeout(timer);
    stop?.();
    stop = undefined;
    bubble?.remove();
    bubble = null;
    node.removeAttribute("aria-describedby");
    document.removeEventListener("keydown", onKey);
  }

  const onEnter = () => {
    clearTimeout(timer);
    const delay = opts.delay ?? 400;
    if (delay <= 0) show();
    else timer = setTimeout(show, delay);
  };

  // focusin/focusout bubble, so a wrapper around a control works too.
  node.addEventListener("mouseenter", onEnter);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("mousedown", hide);
  node.addEventListener("focusin", show);
  node.addEventListener("focusout", hide);

  return {
    update(next: TooltipOptions) {
      opts = next;
      if (bubble) {
        hide();
        show();
      }
    },
    destroy() {
      hide();
      node.removeEventListener("mouseenter", onEnter);
      node.removeEventListener("mouseleave", hide);
      node.removeEventListener("mousedown", hide);
      node.removeEventListener("focusin", show);
      node.removeEventListener("focusout", hide);
    },
  };
}
