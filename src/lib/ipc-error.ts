import type { AtlasError } from "../types/generated/AtlasError";

/** What a rejected command is: one of the backend's `AtlasError` kinds, or
 *  `unknown` for anything that is not an `AtlasError` (plugin errors, strings). */
export type IpcErrorKind = AtlasError["kind"] | "unknown";

/** A rejected `invoke`, with the backend's `kind` to branch on and `message` to show. */
export class IpcError extends Error {
  readonly kind: IpcErrorKind;
  /** The variant's other fields, e.g. `{ tool: "git" }` for `toolMissing`. */
  readonly fields: Readonly<Record<string, unknown>>;

  constructor(kind: IpcErrorKind, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this.name = "IpcError";
    this.kind = kind;
    this.fields = fields;
  }
}

// `satisfies` makes this list fail to compile when the backend gains a kind.
const KINDS = {
  invalidInput: true,
  notFound: true,
  forbidden: true,
  io: true,
  toolMissing: true,
  toolFailed: true,
  timeout: true,
  parse: true,
  internal: true,
} satisfies Record<AtlasError["kind"], true>;

const KIND_SET: ReadonlySet<string> = new Set(Object.keys(KINDS));

function isAtlasError(raw: unknown): raw is AtlasError {
  if (typeof raw !== "object" || raw === null) return false;
  const { kind, message } = raw as Record<string, unknown>;
  return typeof kind === "string" && KIND_SET.has(kind) && typeof message === "string";
}

function describe(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  try {
    return JSON.stringify(raw) ?? String(raw);
  } catch {
    return String(raw);
  }
}

/** Whatever `invoke` rejected with, as an `IpcError`. */
export function toIpcError(raw: unknown): IpcError {
  if (raw instanceof IpcError) return raw;
  if (isAtlasError(raw)) {
    const { kind, message, ...fields } = raw;
    return new IpcError(kind, message, fields);
  }
  return new IpcError("unknown", describe(raw));
}

/** The text to show a user for any caught value. */
export function errorMessage(e: unknown): string {
  return toIpcError(e).message;
}
