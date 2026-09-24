import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../ipc", () => ({
  lspStart: vi.fn(),
  lspSend: vi.fn(),
  lspStop: vi.fn(),
  onLspMessage: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { lspSend, lspStart, onLspMessage } from "../ipc";
import { resetLspClients, transportFor } from "../lsp-client";

/** Handlers the backend event listener was given, so a test can push messages. */
let pushes: ((id: string, message: string) => void)[] = [];

beforeEach(() => {
  resetLspClients();
  pushes = [];
  vi.mocked(lspStart).mockReset();
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
    vi.mocked(lspStart).mockRejectedValue(new Error("no language server installed for cobol"));
    expect(await transportFor("cobol", "/repo")).toBeNull();
  });

  it("delivers only the messages belonging to its own session", async () => {
    vi.mocked(lspStart).mockResolvedValue("typescript:/repo");
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
    vi.mocked(lspStart).mockResolvedValue("typescript:/repo");
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
    vi.mocked(lspStart).mockResolvedValue("typescript:/repo");
    await transportFor("typescript", "/repo");
    await transportFor("typescript", "/repo");
    expect(vi.mocked(lspStart)).toHaveBeenCalledTimes(1);
  });

  it("sends on the session it was started for", async () => {
    vi.mocked(lspStart).mockResolvedValue("typescript:/repo");
    const transport = await transportFor("typescript", "/repo");
    transport?.send('{"jsonrpc":"2.0"}');
    expect(vi.mocked(lspSend)).toHaveBeenCalledWith("typescript:/repo", '{"jsonrpc":"2.0"}');
  });
});
