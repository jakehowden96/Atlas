import { describe, expect, it } from "vitest";
import { languageIdFor } from "../code-lang";

describe("languageIdFor", () => {
  /* The id goes to the language server verbatim, so these are LSP's names and
     not CodeMirror's or the file extension. */
  it("names the LSP language for the extensions this repo is written in", () => {
    expect(languageIdFor("src/lib/ipc.ts")).toBe("typescript");
    expect(languageIdFor("src/App.svelte")).toBe("svelte");
    expect(languageIdFor("src-tauri/src/lib.rs")).toBe("rust");
    expect(languageIdFor("package.json")).toBe("json");
    expect(languageIdFor("README.md")).toBe("markdown");
  });

  it("separates the react dialects, which have their own language ids", () => {
    expect(languageIdFor("a/Thing.tsx")).toBe("typescriptreact");
    expect(languageIdFor("a/Thing.jsx")).toBe("javascriptreact");
  });

  it("is case-insensitive about the extension", () => {
    expect(languageIdFor("SHOUT.TS")).toBe("typescript");
  });

  it("falls back to plaintext for anything unrecognised", () => {
    expect(languageIdFor("LICENSE")).toBe("plaintext");
    expect(languageIdFor("notes.wat")).toBe("plaintext");
  });
});
