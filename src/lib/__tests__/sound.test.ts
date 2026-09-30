import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const created: number[] = [];
const started: number[] = [];
const stopped: number[] = [];
let state: "running" | "suspended" = "running";
const resume = vi.fn();

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeAudioContext {
  currentTime = 10;
  destination = {};
  get state() {
    return state;
  }
  resume = resume;
  constructor() {
    created.push(1);
  }
  createGain() {
    const node = { gain: new FakeParam(), connect: (next: unknown) => next };
    return node;
  }
  createOscillator() {
    const osc = {
      type: "",
      frequency: new FakeParam(),
      connect: (next: unknown) => next,
      start: (at: number) => started.push(at),
      stop: (at: number) => stopped.push(at),
    };
    return osc;
  }
}

vi.stubGlobal("AudioContext", FakeAudioContext);

import { log } from "../logger";
import { playPing } from "../sound";

beforeEach(() => {
  started.length = 0;
  stopped.length = 0;
  resume.mockClear();
  state = "running";
});

describe("playPing", () => {
  it("plays a short tone that ends shortly after it starts", () => {
    playPing();
    expect(started).toEqual([10]);
    expect(stopped).toHaveLength(1);
    const length = stopped[0]! - started[0]!;
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThan(1);
  });

  it("reuses one audio context across pings and wakes it when suspended", () => {
    playPing();
    state = "suspended";
    playPing();
    expect(created).toHaveLength(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("swallows an audio failure and logs it", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio device");
        }
      },
    );
    // The earlier tests already created the shared context; a fresh module is
    // needed to see the constructor throw.
    vi.resetModules();
    return import("../sound").then(({ playPing: fresh }) => {
      expect(() => fresh()).not.toThrow();
      expect(log.warn).toHaveBeenCalled();
    });
  });
});
