import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => {
  class FakeChannel<T> {
    onmessage: (message: T) => void = () => {};
    static last: FakeChannel<unknown> | null = null;
    constructor() {
      FakeChannel.last = this as FakeChannel<unknown>;
    }
  }
  return { FakeChannel, invoke: vi.fn() };
});

vi.mock("@tauri-apps/api/core", () => ({ Channel: tauri.FakeChannel, invoke: tauri.invoke }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ptySpawn } from "../ipc";

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

describe("ptySpawn output", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue(7);
  });

  it("hands raw channel bytes to the terminal unchanged and in order", async () => {
    const received: number[][] = [];
    await ptySpawn(80, 24, (data) => received.push([...data]));

    const channel = tauri.FakeChannel.last;
    channel?.onmessage(bytes(0x1b, 0x5b, 0x00, 0xff));
    channel?.onmessage(bytes(0x0a));

    expect(received).toEqual([[0x1b, 0x5b, 0x00, 0xff], [0x0a]]);
  });
});
