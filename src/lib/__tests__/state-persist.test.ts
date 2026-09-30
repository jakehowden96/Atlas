import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ipc", () => ({ stateSave: vi.fn() }));

import { stateSave } from "../ipc";
import { createStatePersister } from "../state-persist";

/** A `stateSave` that stays in flight until the test releases it. */
function deferSaves() {
  const releases: (() => void)[] = [];
  vi.mocked(stateSave).mockImplementation(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  return {
    releaseNext: async () => {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("createStatePersister", () => {
  beforeEach(() => {
    vi.mocked(stateSave).mockReset();
    vi.mocked(stateSave).mockResolvedValue(undefined);
  });

  it("writes nothing until the load has settled, then writes the latest state once", async () => {
    let value = 1;
    const p = createStatePersister("settings", () => ({ value }), vi.fn());

    await p.request();
    value = 2;
    await p.request();
    expect(stateSave).not.toHaveBeenCalled();

    value = 3;
    p.markLoaded();
    await p.request();

    expect(stateSave).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(stateSave).mock.calls[0][1])).toEqual({ value: 3 });
  });

  it("keeps one save in flight and folds requests made meanwhile into one latest-wins write", async () => {
    const gate = deferSaves();
    let value = 1;
    const p = createStatePersister("workspaces", () => ({ value }), vi.fn());
    p.markLoaded();

    const first = p.request();
    await Promise.resolve();
    value = 2;
    const second = p.request();
    value = 3;
    const third = p.request();
    await Promise.resolve();
    expect(stateSave).toHaveBeenCalledTimes(1);

    await gate.releaseNext();
    await gate.releaseNext();
    await Promise.all([first, second, third]);

    expect(stateSave).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stateSave).mock.calls.map((c) => JSON.parse(c[1]).value)).toEqual([1, 3]);
  });

  it("reports a failed write and keeps serving later requests", async () => {
    const onError = vi.fn();
    vi.mocked(stateSave).mockRejectedValueOnce(new Error("disk full"));
    let value = 1;
    const p = createStatePersister("settings", () => ({ value }), onError);
    p.markLoaded();

    await p.request();
    expect(onError).toHaveBeenCalledTimes(1);

    value = 2;
    await p.request();
    expect(JSON.parse(vi.mocked(stateSave).mock.calls[1][1])).toEqual({ value: 2 });
  });

  it("survives a snapshot that throws", async () => {
    const onError = vi.fn();
    let broken = true;
    const p = createStatePersister(
      "settings",
      () => {
        if (broken) throw new Error("unserialisable");
        return { ok: true };
      },
      onError,
    );
    p.markLoaded();

    await p.request();
    expect(onError).toHaveBeenCalledTimes(1);

    broken = false;
    await p.request();
    expect(stateSave).toHaveBeenCalledTimes(1);
  });
});
