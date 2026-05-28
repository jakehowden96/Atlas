import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { mountPanelLayout } from "../panel-layout";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];

  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    FakeResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  disconnect() {
    this.observed = [];
  }

  unobserve() {}

  fire() {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

function makeStageEl(width: number): HTMLElement {
  const el = {
    clientWidth: width,
  } as unknown as HTMLElement;
  return el;
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = FakeResizeObserver;
});

describe("panel-layout module", () => {
  it("derives panel width from stageWidth * fraction (1200 × 0.5 = 600)", () => {
    const stageEl = makeStageEl(1200);
    const layout = mountPanelLayout(stageEl);
    expect(get(layout.panelWidth$)).toBe(600);
    layout.destroy();
  });

  it("nudge(+100) with stageWidth=1000 yields fraction=0.6", () => {
    const stageEl = makeStageEl(1000);
    const layout = mountPanelLayout(stageEl);
    layout.nudge(100);
    expect(get(layout.panelWidth$)).toBe(600);
    layout.destroy();
  });

  it("clamps fraction at the lower bound of 0.2", () => {
    const stageEl = makeStageEl(1000);
    const layout = mountPanelLayout(stageEl);
    layout.setFraction(0.05);
    // 0.2 × 1000 = 200
    expect(get(layout.panelWidth$)).toBe(200);
    layout.destroy();
  });

  it("clamps fraction at the upper bound of 0.8", () => {
    const stageEl = makeStageEl(1000);
    const layout = mountPanelLayout(stageEl);
    layout.setFraction(0.95);
    // 0.8 × 1000 = 800
    expect(get(layout.panelWidth$)).toBe(800);
    layout.destroy();
  });

  it("clamps nudge at the upper bound", () => {
    const stageEl = makeStageEl(1000);
    const layout = mountPanelLayout(stageEl);
    layout.nudge(500); // would push fraction to 1.0, clamps to 0.8
    expect(get(layout.panelWidth$)).toBe(800);
    layout.destroy();
  });

  it("clamps nudge at the lower bound", () => {
    const stageEl = makeStageEl(1000);
    const layout = mountPanelLayout(stageEl);
    layout.nudge(-500); // would push fraction to 0.0, clamps to 0.2
    expect(get(layout.panelWidth$)).toBe(200);
    layout.destroy();
  });

  it("stage-width changes do not mutate fraction", () => {
    const stageEl = makeStageEl(1000);
    const layout = mountPanelLayout(stageEl);
    layout.setFraction(0.6);
    expect(get(layout.panelWidth$)).toBe(600);

    // Simulate stage growth via ResizeObserver
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stageEl as any).clientWidth = 2000;
    FakeResizeObserver.instances[0].fire();

    // Fraction unchanged, width recomputed
    expect(get(layout.panelWidth$)).toBe(1200);

    // Nudging now uses the new stage width to translate pixels back into fraction.
    // Sanity: nudge by +200 on a 2000px stage = +0.1, so 0.7.
    layout.nudge(200);
    expect(get(layout.panelWidth$)).toBe(1400);
    layout.destroy();
  });

  it("defaults to fraction 0.5", () => {
    const stageEl = makeStageEl(800);
    const layout = mountPanelLayout(stageEl);
    expect(get(layout.panelWidth$)).toBe(400);
    layout.destroy();
  });
});
