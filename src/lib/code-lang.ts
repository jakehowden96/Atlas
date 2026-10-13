/**
 * File extension → the language's identity, for the code editor and the
 * language server.
 *
 * Two names are needed and they are not the same thing. LSP has its own
 * registry of language ids (`typescriptreact`, not `tsx`), and that string is
 * sent to the server verbatim. CodeMirror's `@codemirror/language-data` has its
 * own names and does its own extension matching, so highlighting is looked up
 * separately in `code-editor.ts` rather than mapped here.
 */

/** LSP language id by lowercase extension, for the languages `src-tauri/src/lsp/server.rs`
 *  has a server for. Anything else is `plaintext`, so opening it never tries to
 *  start a server that cannot exist. */
const LSP_IDS: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  svelte: "svelte",
  rs: "rust",
  py: "python",
  go: "go",
};

/** The extension of `path`, lowercased, or "" when it has none. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * The LSP language id for a path. `plaintext` is LSP's own name for "no
 * particular language" and is what an unrecognised file is announced as; no
 * server is configured for it, so it simply gets no diagnostics.
 */
export function languageIdFor(path: string): string {
  return LSP_IDS[extensionOf(path)] ?? "plaintext";
}
