import { describe, expect, it, vi } from "vitest";

const run = vi.fn((args: string[]) => Promise.resolve(args.join(" ")));
vi.mock("../ipc", () => ({ codeburnRun: (args: string[]) => run(args), codeburnInfo: vi.fn() }));

const { prefetch } = await import("../components/stats/codeburn/prefetch");
const { codeburn } = await import("../stores/codeburn");

describe("prefetch", () => {
  it("skips cached queries and stops when a newer run on the channel starts", async () => {
    await codeburn(["a"]);
    run.mockClear();
    const first = prefetch("tabs", [["a"], ["b"], ["c"]]);
    const second = prefetch("tabs", [["d"]]);
    await Promise.all([first, second]);
    expect(run.mock.calls.map((c) => c[0].join(" "))).toEqual(["b", "d"]);
  });
});
