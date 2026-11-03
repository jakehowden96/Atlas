export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

interface Box {
  width: number;
  height: number;
}

export interface PositionInput {
  anchor: { left: number; top: number; width: number; height: number };
  size: Box;
  viewport: Box;
  side?: Side;
  align?: Align;
  gap?: number;
  pad?: number;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Pure placement: preferred side, flipped when it overflows and the other side fits better, cross axis clamped. */
export function computePosition(input: PositionInput): { x: number; y: number; side: Side } {
  const { anchor: a, size, viewport, side = "top", align = "center", gap = 6, pad = 8 } = input;
  const vertical = (s: Side) => s === "top" || s === "bottom";
  const space = (s: Side) =>
    s === "top"
      ? a.top - pad
      : s === "bottom"
        ? viewport.height - (a.top + a.height) - pad
        : s === "left"
          ? a.left - pad
          : viewport.width - (a.left + a.width) - pad;
  const need = (s: Side) => (vertical(s) ? size.height : size.width) + gap;

  let placed = side;
  if (space(side) < need(side) && space(OPPOSITE[side]) > space(side)) placed = OPPOSITE[side];

  const cross = (start: number, len: number, floatLen: number) =>
    align === "start"
      ? start
      : align === "end"
        ? start + len - floatLen
        : start + (len - floatLen) / 2;
  let x: number;
  let y: number;
  if (vertical(placed)) {
    x = cross(a.left, a.width, size.width);
    y = placed === "top" ? a.top - size.height - gap : a.top + a.height + gap;
    x = Math.max(pad, Math.min(x, viewport.width - size.width - pad));
  } else {
    y = cross(a.top, a.height, size.height);
    x = placed === "left" ? a.left - size.width - gap : a.left + a.width + gap;
    y = Math.max(pad, Math.min(y, viewport.height - size.height - pad));
  }
  return { x, y, side: placed };
}

export interface PlaceOptions {
  side?: Side;
  align?: Align;
  gap?: number;
}

/** Position a fixed element against an anchor now and on scroll/resize. Returns a cleanup. */
export function placeFloating(
  anchor: Element,
  floating: HTMLElement,
  opts: PlaceOptions = {},
): () => void {
  const update = () => {
    const r = anchor.getBoundingClientRect();
    const { x, y, side } = computePosition({
      anchor: { left: r.left, top: r.top, width: r.width, height: r.height },
      size: { width: floating.offsetWidth, height: floating.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ...opts,
    });
    floating.style.left = `${x}px`;
    floating.style.top = `${y}px`;
    floating.dataset.side = side;
  };
  update();
  window.addEventListener("scroll", update, true);
  window.addEventListener("resize", update);
  return () => {
    window.removeEventListener("scroll", update, true);
    window.removeEventListener("resize", update);
  };
}
