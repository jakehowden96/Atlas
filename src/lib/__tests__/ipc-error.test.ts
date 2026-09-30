import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ Channel: class {}, invoke: tauri.invoke }));
vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getGitStatus } from "../ipc";
import { errorMessage, IpcError } from "../ipc-error";

async function rejection(raw: unknown): Promise<IpcError> {
  tauri.invoke.mockRejectedValue(raw);
  const error = await getGitStatus("/repo").then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IpcError);
  return error as IpcError;
}

describe("command rejections", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
  });

  it("keeps the kind, message and extra fields of an AtlasError", async () => {
    const error = await rejection({
      kind: "toolMissing",
      tool: "git",
      message: "git was not found",
    });

    expect(error.kind).toBe("toolMissing");
    expect(error.message).toBe("git was not found");
    expect(error.fields).toEqual({ tool: "git" });
  });

  it("keeps a fieldless kind's fields empty", async () => {
    const error = await rejection({ kind: "forbidden", message: "outside Files" });

    expect(error.kind).toBe("forbidden");
    expect(error.fields).toEqual({});
  });

  it("turns a plain string rejection (a plugin) into kind unknown", async () => {
    const error = await rejection("plugin exploded");

    expect(error.kind).toBe("unknown");
    expect(error.message).toBe("plugin exploded");
  });

  it("turns an Error rejection into kind unknown with its message", async () => {
    const error = await rejection(new Error("boom"));

    expect(error.kind).toBe("unknown");
    expect(error.message).toBe("boom");
  });

  it("does not trust an object whose kind is not one the backend sends", async () => {
    const error = await rejection({ kind: "mystery", message: "?" });

    expect(error.kind).toBe("unknown");
    expect(error.message).toBe('{"kind":"mystery","message":"?"}');
  });

  it("treats an object without a string message as unknown", async () => {
    const error = await rejection({ kind: "io" });

    expect(error.kind).toBe("unknown");
  });

  it("does not reject an inherited name such as toString as a kind", async () => {
    const error = await rejection({ kind: "toString", message: "x" });

    expect(error.kind).toBe("unknown");
  });
});

describe("errorMessage", () => {
  it("reads the message of anything a catch can hold", () => {
    expect(errorMessage({ kind: "io", message: "disk full" })).toBe("disk full");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(new Error("e"))).toBe("e");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
