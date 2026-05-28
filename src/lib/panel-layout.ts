import { writable, type Readable } from "svelte/store";

export const MIN_PANEL_FRACTION = 0.2;
export const MAX_PANEL_FRACTION = 0.8;
export const DEFAULT_PANEL_FRACTION = 0.5;

function clampFraction(f: number): number {
  if (f < MIN_PANEL_FRACTION) return MIN_PANEL_FRACTION;
  if (f > MAX_PANEL_FRACTION) return MAX_PANEL_FRACTION;
  return f;
}

export interface PanelLayout {
  /** Current panel pixel width, derived from stage width × fraction. */
  panelWidth$: Readable<number>;
  /** Set the panel fraction directly (clamped to [0.2, 0.8]). */
  setFraction(f: number): void;
  /** Adjust the panel width by a pixel delta; translated back to a fraction. */
  nudge(deltaPx: number): void;
  /** Stop observing the stage element. */
  destroy(): void;
}

/**
 * Owns the panel's fractional width within a "stage" element. The pixel width
 * is always `stageEl.clientWidth * fraction`, and updates automatically when the
 * stage resizes via ResizeObserver. The fraction itself only changes through
 * `setFraction` or `nudge` — stage resizes do not mutate it.
 */
export function mountPanelLayout(stageEl: HTMLElement): PanelLayout {
  let fraction = DEFAULT_PANEL_FRACTION;
  let stageWidth = stageEl.clientWidth;

  const panelWidth$ = writable(Math.round(stageWidth * fraction));

  function recompute() {
    panelWidth$.set(Math.round(stageWidth * fraction));
  }

  function setFraction(f: number) {
    fraction = clampFraction(f);
    recompute();
  }

  function nudge(deltaPx: number) {
    if (stageWidth <= 0) return;
    setFraction(fraction + deltaPx / stageWidth);
  }

  const observer = new ResizeObserver(() => {
    stageWidth = stageEl.clientWidth;
    recompute();
  });
  observer.observe(stageEl);

  return {
    panelWidth$,
    setFraction,
    nudge,
    destroy() {
      observer.disconnect();
    },
  };
}
