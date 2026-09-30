/** Mirrors `LspStart` in `src-tauri/src/lsp/mod.rs`. */
export type LspStart =
  | { kind: "started"; id: string }
  | { kind: "notTrusted" }
  | { kind: "noServer" };
