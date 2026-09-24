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

/** LSP language id by lowercase extension. */
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
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  cs: "csharp",
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
