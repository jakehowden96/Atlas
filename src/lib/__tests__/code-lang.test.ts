import { describe, expect, it } from "vitest";
import { languageIdFor } from "../code-lang";

describe("languageIdFor", () => {
  /* The id goes to the language server verbatim, so these are LSP's names and
     not CodeMirror's or the file extension. */
  it("names the LSP language for the extensions this repo is written in", () => {
    expect(languageIdFor("src/lib/ipc.ts")).toBe("typescript");
    expect(languageIdFor("src/App.svelte")).toBe("svelte");
    expect(languageIdFor("src-tauri/src/lib.rs")).toBe("rust");
  });

  /* Every id here would start a language server, so a language Atlas ships no
     server for must not have one — it would fail a spawn per workspace root. */
  it("names only languages that have a server, so others never try to start one", () => {
    expect(languageIdFor("package.json")).toBe("plaintext");
    expect(languageIdFor("README.md")).toBe("plaintext");
    expect(languageIdFor("style.css")).toBe("plaintext");
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
