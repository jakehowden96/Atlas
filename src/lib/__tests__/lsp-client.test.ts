import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../ipc", () => ({
  lspStart: vi.fn(),
  lspSend: vi.fn(),
  lspStop: vi.fn(),
  onLspMessage: vi.fn(),
  onLspExit: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { get } from "svelte/store";
import { lspSend, lspStart, lspStop, onLspExit, onLspMessage } from "../ipc";
import {
  clientFor,
  resetLspClients,
  stopServersFor,
  transportFor,
  untrustedRoots,
} from "../lsp-client";

const started = (id: string) => ({ kind: "started" as const, id });

/** Handlers the backend event listener was given, so a test can push messages. */
let pushes: ((id: string, message: string) => void)[] = [];
/** Handlers the backend exit listener was given. */
let exits: ((id: string) => void)[] = [];

beforeEach(() => {
  resetLspClients();
  pushes = [];
  exits = [];
  vi.mocked(lspStart).mockReset();
  vi.mocked(lspStop).mockReset();
  vi.mocked(lspStop).mockResolvedValue(undefined);
  vi.mocked(onLspExit).mockReset();
  vi.mocked(onLspExit).mockImplementation(async (fn) => {
    exits.push(fn);
    return () => {};
  });
  vi.mocked(lspSend).mockReset();
  vi.mocked(lspSend).mockResolvedValue(undefined);
  vi.mocked(onLspMessage).mockReset();
  vi.mocked(onLspMessage).mockImplementation(async (fn) => {
    pushes.push(fn);
    return () => {};
  });
});

describe("transportFor", () => {
  it("is null when no server is installed for the language", async () => {
    vi.mocked(lspStart).mockResolvedValue({ kind: "noServer" });
    expect(await transportFor("cobol", "/repo")).toBeNull();
  });

  it("delivers only the messages belonging to its own session", async () => {
    vi.mocked(lspStart).mockResolvedValue(started("typescript:/repo"));
    const transport = await transportFor("typescript", "/repo");
    expect(transport).not.toBeNull();

    const seen: string[] = [];
    transport?.subscribe((m) => seen.push(m));
    for (const push of pushes) {
      push("typescript:/repo", '{"mine":1}');
      push("rust:/other", '{"theirs":1}');
    }

    expect(seen).toEqual(['{"mine":1}']);
  });

  it("stops delivering to a handler once it unsubscribes", async () => {
    vi.mocked(lspStart).mockResolvedValue(started("typescript:/repo"));
    const transport = await transportFor("typescript", "/repo");
    const seen: string[] = [];
    const handler = (m: string) => seen.push(m);
    transport?.subscribe(handler);
    transport?.unsubscribe(handler);
    for (const push of pushes) push("typescript:/repo", '{"a":1}');
    expect(seen).toEqual([]);
  });

  /* Starting rust-analyzer twice for one repo indexes it twice, so a second
     editor on the same language has to land on the session already running. */
  it("starts one server per language and workspace", async () => {
    vi.mocked(lspStart).mockResolvedValue(started("typescript:/repo"));
    await transportFor("typescript", "/repo");
    await transportFor("typescript", "/repo");
    expect(vi.mocked(lspStart)).toHaveBeenCalledTimes(1);
  });
});

describe("failed and concurrent starts", () => {
  it("retries a start that failed instead of remembering the failure", async () => {
    vi.mocked(lspStart).mockRejectedValueOnce(new Error("spawn failed"));
    vi.mocked(lspStart).mockResolvedValueOnce(started("typescript:/repo"));
    expect(await transportFor("typescript", "/repo")).toBeNull();
    expect(await transportFor("typescript", "/repo")).not.toBeNull();
  });

  it("gives two editors mounting together the same client", async () => {
    vi.mocked(lspStart).mockResolvedValue(started("typescript:/repo"));
    const [a, b] = await Promise.all([
      clientFor("typescript", "/repo"),
      clientFor("typescript", "/repo"),
    ]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("roots the client at a percent-encoded uri", async () => {
    vi.mocked(lspStart).mockResolvedValue(started("typescript:/My Projects/app"));
    const client = await clientFor("typescript", "/My Projects/app");
    // `config` is internal to the library but is exactly what is sent as rootUri.
    expect((client as unknown as { config: { rootUri: string } }).config.rootUri).toBe(
      "file:///My%20Projects/app",
    );
  });
});

describe("language server trust", () => {
  it("is null, and remembers the workspace as untrusted, when servers are off there", async () => {
    vi.mocked(lspStart).mockResolvedValue({ kind: "notTrusted" });
    expect(await transportFor("typescript", "/repo")).toBeNull();
    expect(get(untrustedRoots).has("/repo")).toBe(true);
  });

  it("asks again after trust is granted instead of remembering the refusal", async () => {
    vi.mocked(lspStart).mockResolvedValueOnce({ kind: "notTrusted" });
    vi.mocked(lspStart).mockResolvedValueOnce(started("typescript:/repo"));
    expect(await transportFor("typescript", "/repo")).toBeNull();
    expect(await transportFor("typescript", "/repo")).not.toBeNull();
    expect(get(untrustedRoots).has("/repo")).toBe(false);
  });
});

describe("a server that exits on its own", () => {
  it("is forgotten, so the next editor starts a fresh server", async () => {
    vi.mocked(lspStart).mockResolvedValueOnce(started("typescript:/repo"));
    vi.mocked(lspStart).mockResolvedValueOnce(started("typescript:/repo"));
    const first = await clientFor("typescript", "/repo");
    expect(first).not.toBeNull();

    for (const exit of exits) exit("typescript:/repo");
    const second = await clientFor("typescript", "/repo");

    expect(vi.mocked(lspStart)).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("leaves other workspaces' servers alone", async () => {
    vi.mocked(lspStart).mockImplementation(async (lang, root) => started(`${lang}:${root}`));
    const other = await clientFor("typescript", "/other");
    await clientFor("typescript", "/repo");

    for (const exit of exits) exit("typescript:/repo");

    expect(await clientFor("typescript", "/other")).toBe(other);
  });
});

describe("stopServersFor", () => {
  it("stops every server in that workspace and none elsewhere", async () => {
    vi.mocked(lspStart).mockImplementation(async (lang, root) => started(`${lang}:${root}`));
    await transportFor("typescript", "/repo");
    await transportFor("rust", "/repo");
    await transportFor("typescript", "/other");

    await stopServersFor("/repo");

    expect(
      vi
        .mocked(lspStop)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["rust:/repo", "typescript:/repo"]);
  });

  it("lets a server be started again afterwards", async () => {
    vi.mocked(lspStart).mockImplementation(async (lang, root) => started(`${lang}:${root}`));
    await transportFor("typescript", "/repo");
    await stopServersFor("/repo");
    await transportFor("typescript", "/repo");
    expect(vi.mocked(lspStart)).toHaveBeenCalledTimes(2);
  });
});
