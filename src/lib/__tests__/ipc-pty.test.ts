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
    await ptySpawn(80, 24, { onData: (data) => received.push([...data]), onExit: () => {} });

    const channel = tauri.FakeChannel.last;
    channel?.onmessage(bytes(0x1b, 0x5b, 0x00, 0xff));
    channel?.onmessage(bytes(0x0a));

    expect(received).toEqual([[0x1b, 0x5b, 0x00, 0xff], [0x0a]]);
  });

  it("reports the exit after the output that preceded it", async () => {
    const events: string[] = [];
    await ptySpawn(80, 24, {
      onData: (data) => events.push(`data:${data.length}`),
      onExit: (exit) => events.push(`exit:${exit.code}`),
    });

    const channel = tauri.FakeChannel.last;
    channel?.onmessage(bytes(1, 2, 3));
    channel?.onmessage({ exit: { code: 3, signal: null } });

    expect(events).toEqual(["data:3", "exit:3"]);
  });
});
