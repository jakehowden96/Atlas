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
    oscHandlers = new Map<number, (data: string) => boolean>();
    parser = {
      registerOscHandler: (id: number, cb: (data: string) => boolean) => {
        this.oscHandlers.set(id, cb);
      },
      registerCsiHandler: () => undefined,
    };
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
    static instances: FakeLinks[] = [];
    constructor(public handler?: (event: MouseEvent, uri: string) => void) {
      FakeLinks.instances.push(this);
    }
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
vi.mock("../stores/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/workspace")>()),
  updateSessionLabelByTabId: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getPanelData,
  openUrl,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
  refreshPanel,
} from "../ipc";
import { parseOsc7, TerminalSession } from "../terminal-session";
import { toasts } from "../stores/toast";
import { addTab, tabs } from "../stores/terminal";
import { updateSessionLabelByTabId } from "../stores/workspace";

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

const resizeObservers: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  resizeObservers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resizeObservers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.clearAllMocks();
  fakes.FakeWebgl.instances.length = 0;
  fakes.FakeLinks.instances.length = 0;
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

describe("TerminalSession title changes", () => {
  it("relabels the session once for a repeated title and leaves the tab list alone", async () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    addTab({ type: "terminal", id: "tab-1", ptyId: 7 });
    const { terminal } = makeSession();
    await vi.advanceTimersByTimeAsync(0);
    let emissions = 0;
    const unsubscribe = tabs.subscribe(() => emissions++);
    emissions = 0;

    const osc2 = terminal.oscHandlers.get(2);
    osc2?.("Fix the login bug");
    osc2?.("Fix the login bug");
    terminal.oscHandlers.get(0)?.("Fix the login bug");
    await vi.advanceTimersByTimeAsync(1000);
    unsubscribe();

    expect(updateSessionLabelByTabId).toHaveBeenCalledTimes(1);
    expect(updateSessionLabelByTabId).toHaveBeenCalledWith("tab-1", "Fix the login bug");
    expect(emissions).toBe(0);
  });
});

describe("TerminalSession renderer", () => {
  it("falls back to the DOM renderer when a WebGL context is lost", () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    makeSession();
    const [webgl] = fakes.FakeWebgl.instances;

    webgl.contextLoss?.();

    expect(webgl.disposed).toBe(true);
  });
});

describe("TerminalSession links", () => {
  function clickLink(uri: string) {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    makeSession();
    const [links] = fakes.FakeLinks.instances;
    links.handler?.({} as MouseEvent, uri);
  }

  it("opens a clicked link through the validated open_url command", async () => {
    vi.mocked(openUrl).mockResolvedValue(undefined);
    clickLink("https://example.com/docs");
    await vi.advanceTimersByTimeAsync(0);

    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(get(toasts)).toHaveLength(0);
  });

  it("tells the user when open_url refuses the link, without leaking a rejection", async () => {
    const open = rejectUnobserved(vi.mocked(openUrl), new Error("only https URLs can be opened"));
    clickLink("http://localhost:3000");
    await vi.advanceTimersByTimeAsync(0);

    expect(open.wasHandled()).toBe(true);
    expect(get(toasts)).toHaveLength(1);
  });
});

describe("TerminalSession panel refresh", () => {
  it("does not toast every poll when the working directory has vanished", async () => {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    vi.mocked(refreshPanel).mockRejectedValue(new Error("cwd does not exist"));
    const shown = new Set<string>();
    const unsubscribe = toasts.subscribe((list) => {
      for (const t of list) shown.add(t.id);
    });
    makeSession();

    await vi.advanceTimersByTimeAsync(95_000);
    unsubscribe();

    expect(refreshPanel).toHaveBeenCalledTimes(4);
    expect(shown.size).toBe(0);
  });
});

describe("TerminalSession resizing", () => {
  async function resizedCalls(visible: boolean, bursts: number) {
    vi.mocked(ptySpawn).mockResolvedValue(7);
    makeSession({ visible });
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(ptyResize).mockClear();
    for (let i = 0; i < bursts; i++) {
      for (const notify of resizeObservers) notify();
      await vi.advanceTimersByTimeAsync(16);
    }
    await vi.advanceTimersByTimeAsync(500);
    return vi.mocked(ptyResize).mock.calls.length;
  }

  it("tracks every resize of the terminal on screen", async () => {
    expect(await resizedCalls(true, 10)).toBe(10);
  });

  it("settles a parked terminal once after a burst of window resizes", async () => {
    expect(await resizedCalls(false, 10)).toBe(1);
  });
});

describe("parseOsc7", () => {
  it.each([
    ["file://host/Users/x/proj", "/Users/x/proj"],
    ["file:///Users/x/my%20dir", "/Users/x/my dir"],
    ["file://HOST/C:/Users/x/proj", "C:/Users/x/proj"],
    ["file:///C:/", "C:/"],
    ["C:\\Users\\x", "C:\\Users\\x"],
    ["/plain/path", "/plain/path"],
    ["  /padded  ", "/padded"],
  ])("reads %s as %s", (data, cwd) => {
    expect(parseOsc7(data)).toBe(cwd);
  });

  it.each([[""], ["   "], ["file://host/bad%zzescape"]])("rejects %j", (data) => {
    expect(parseOsc7(data)).toBeNull();
  });
});
