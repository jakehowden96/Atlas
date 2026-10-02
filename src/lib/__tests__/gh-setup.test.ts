import { describe, expect, it } from "vitest";
import { setupHint, setupProblem } from "../gh-setup";
import type { GhError } from "../../types/generated/GhError";
import type { RepoPrs } from "../../types/generated/RepoPrs";

const NOT_INSTALLED: GhError = { kind: "not_installed", message: "no gh" };
const SIGNED_OUT: GhError = { kind: "not_authenticated", message: "run gh auth login" };
const TIMED_OUT: GhError = { kind: "timed_out", message: "slow" };

function repo(error: GhError | null): RepoPrs {
  return { repo: "o/r", prs: [], error };
}

describe("setupProblem", () => {
  it("is null while nothing is wrong", () => {
    expect(setupProblem(null, null)).toBeNull();
    expect(setupProblem([repo(null)], null)).toBeNull();
  });

  it("finds gh missing from the viewer lookup or from any repo", () => {
    expect(setupProblem(null, NOT_INSTALLED)).toBe(NOT_INSTALLED);
    expect(setupProblem([repo(null), repo(SIGNED_OUT)], null)).toBe(SIGNED_OUT);
  });

  it("leaves a timeout on its own repo's card", () => {
    expect(setupProblem([repo(TIMED_OUT)], TIMED_OUT)).toBeNull();
    expect(setupProblem([repo({ kind: "failed", message: "x" })], null)).toBeNull();
  });
});

describe("setupHint", () => {
  it("names the install command for the platform, then the sign-in", () => {
    expect(setupHint(NOT_INSTALLED, true)?.commands).toEqual(["brew install gh", "gh auth login"]);
    expect(setupHint(NOT_INSTALLED, false)?.commands).toEqual([
      "winget install --id GitHub.cli",
      "gh auth login",
    ]);
  });

  it("only asks to sign in when gh is there", () => {
    expect(setupHint(SIGNED_OUT, true)?.commands).toEqual(["gh auth login"]);
  });

  it("has no setup hint for failures the user cannot fix from a command", () => {
    expect(setupHint(TIMED_OUT, true)).toBeNull();
  });
});
