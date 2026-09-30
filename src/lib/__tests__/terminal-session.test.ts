import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const fakes = vi.hoisted(() => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    dataHandlers: ((data: string) => void)[] = [];
    written: unknown[] = [];
    disposed = false;
    buffer = { active: { baseY: 0, cursorY: 0, getLine: () => undefined } };
    parser = { registerOscHandler: () => undefined, registerCsiHandler: () => undefined };
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onWriteParsed() {}
    onResize() {}
    onData(cb: (data: string) => void) {
      this.dataHandlers.push(cb);
    }
    write(data: unknown) {
      if (this.disposed) throw new Error("write after dispose");
      this.written.push(data);
    }
    hasSelection() {
      if (this.disposed) throw new Error("hasSelection after dispose");
      return false;
    }
    getSelection() {
      return "";
    }
    focus() {}
    registerMarker() {
      return undefined;
    }
    registerDecoration() {
      return undefined;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class FakeFit {
    fit = vi.fn();
  }
  class FakeLinks {
    constructor(public handler?: (event: MouseEvent, uri: string) => void) {}
  }
  class FakeWebgl {
    static instances: FakeWebgl[] = [];
    contextLoss: (() => void) | null = null;
    disposed = false;
    constructor() {
      FakeWebgl.instances.push(this);
    }
    onContextLoss(cb: () => void) {
      this.contextLoss = cb;
      return { dispose() {} };
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { FakeTerminal, FakeFit, FakeLinks, FakeWebgl };
});

vi.mock("@xterm/xterm", () => ({ Terminal: fakes.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: fakes.FakeFit }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: fakes.FakeLinks }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: fakes.FakeWebgl }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
}));
vi.mock("../ipc", () => ({
  ptySpawn: vi.fn(),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyKill: vi.fn(),
  refreshPanel: vi.fn(),
  getPanelData: vi.fn(),
  openUrl: vi.fn(),
  startOmpTail: vi.fn(),
  startSessionTail: vi.fn(),
  stopSessionTail: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getPanelData, ptyKill, ptyResize, ptySpawn, ptyWrite, refreshPanel } from "../ipc";
import { TerminalSession } from "../terminal-session";
import { toasts } from "../stores/toast";

type SpawnOnData = (data: Uint8Array) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function container(size = { w: 800, h: 600 }) {
  return {
    clientWidth: size.w,
    clientHeight: size.h,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLDivElement;
}

function makeSession(overrides: Partial<ConstructorParameters<typeof TerminalSession>[0]> = {}) {
  const onPtyReady = vi.fn();
  const onSpawnError = vi.fn();
  const session = new TerminalSession({
    tabId: "tab-1",
    container: container(),
    visible: true,
    onPtyReady,
    onSpawnError,
    cwd: "/work",
    ...overrides,
  });
  // The private xterm is what the handlers under test are attached to.
  const terminal = (session as unknown as { terminal: InstanceType<typeof fakes.FakeTerminal> })
    .terminal;
  return { session, terminal, onPtyReady, onSpawnError };
}

/**
 * Make `fn` fail every call with a rejection nobody is forced to handle, and
 * report whether a caller ever attached a handler. `vi.fn` itself observes the
 * promises it returns, which would hide a missing `.catch` from the runtime's
 * unhandled-rejection tracking, so the rejection is a bare thenable instead.
 */
function rejectUnobserved(fn: { mockImplementation: (impl: () => never) => unknown }, err: Error) {
  let observed = false;
  const rejection = {
    // biome-ignore lint/suspicious/noThenProperty: a bare thenable is the point — see above
    then(onFulfilled?: unknown, onRejected?: (reason: unknown) => unknown) {
      observed = true;
      return Promise.reject(err).then(onFulfilled as never, onRejected);
    },
    catch(onRejected?: (reason: unknown) => unknown) {
      return this.then(undefined, onRejected);
    },
  };
  fn.mockImplementation(() => rejection as never);
  return { wasHandled: () => observed };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.clearAllMocks();
  fakes.FakeWebgl.instances.length = 0;
  toasts.set([]);
  vi.mocked(ptyWrite).mockResolvedValue(undefined);
  vi.mocked(ptyResize).mockResolvedValue(undefined);
  vi.mocked(ptyKill).mockResolvedValue(undefined);
  vi.mocked(refreshPanel).mockResolvedValue(null);
  vi.mocked(getPanelData).mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TerminalSession PTY lifecycle", () => {
  it("kills a PTY that finishes spawning after the tab was already closed", async () => {
    const spawn = deferred<number>();
    vi.mocked(ptySpawn).mockReturnValue(spawn.promise);
    const { session, onPtyReady } = makeSession();

    session.destroy();
    spawn.resolve(42);
    await vi.advanceTimersByTimeAsync(0);

    expect(ptyKill).toHaveBeenCalledWith(42, "tab-1");
    expect(onPtyReady).not.toHaveBeenCalled();
  });

  it("ignores output that arrives after the terminal was disposed", async () => {
    let channel: SpawnOnData = () => {};
    vi.mocked(ptySpawn).mockImplementation(async (_c, _r, onData) => {
      channel = onData;
      return 7;
    });
    const { session, terminal } = makeSession();
    await vi.advanceTimersByTimeAsync(0);

    session.destroy();

    expect(() => channel(new Uint8Array([104, 105]))).not.toThrow();
    expect(terminal.written).toHaveLength(0);
  });

  it("reports a failed spawn so the tab can leave 'Starting…'", async () => {
    vi.mocked(ptySpawn).mockRejectedValue(new Error("no shell"));
    const { onSpawnError, onPtyReady } = makeSession();

    await vi.advanceTimersByTimeAsync(0);

    expect(onSpawnError).toHaveBeenCalledTimes(1);
    expect(String(onSpawnError.mock.calls[0][0])).toContain("no shell");
    expect(onPtyReady).not.toHaveBeenCalled();
  });

  it("handles a rejected write to a dead PTY and says so once", async () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    const { terminal } = makeSession();
    await vi.advanceTimersByTimeAsync(0);
    const write = rejectUnobserved(vi.mocked(ptyWrite), new Error("pty 7 gone"));

    for (const handler of terminal.dataHandlers) {
      handler("a");
      handler("b");
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(write.wasHandled()).toBe(true);
    expect(get(toasts)).toHaveLength(1);
  });

  it("handles a rejected resize of a dead PTY", async () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    const { session } = makeSession();
    await vi.advanceTimersByTimeAsync(0);
    const resize = rejectUnobserved(vi.mocked(ptyResize), new Error("pty 7 gone"));

    (session as unknown as { refit: () => void }).refit();
    await vi.advanceTimersByTimeAsync(0);

    expect(ptyResize).toHaveBeenCalledWith(7, 80, 24);
    expect(resize.wasHandled()).toBe(true);
  });

  it("handles a rejected kill on close", async () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    const { session } = makeSession();
    await vi.advanceTimersByTimeAsync(0);
    const kill = rejectUnobserved(vi.mocked(ptyKill), new Error("already dead"));

    session.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(ptyKill).toHaveBeenCalledWith(7, "tab-1");
    expect(kill.wasHandled()).toBe(true);
  });

  it("does not refresh the panel for a tab that closed within a second of Enter", async () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    const { session, terminal } = makeSession();
    await vi.advanceTimersByTimeAsync(0);

    for (const handler of terminal.dataHandlers) handler("\r");
    session.destroy();
    await vi.advanceTimersByTimeAsync(5000);

    expect(refreshPanel).not.toHaveBeenCalled();
  });
});
