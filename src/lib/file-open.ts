import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { get } from "svelte/store";
import { addFileTab } from "./stores/terminal";
import { activeWorkspacePath } from "./stores/workspace";
import { showToast } from "./stores/toast";
import type { FileLanguage } from "../types/terminal";
import { log } from "./logger";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

const EXTENSION_MAP: Record<string, FileLanguage> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  svelte: "html",
  css: "css",
  scss: "css",
  py: "python",
  rs: "rust",
  toml: "toml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  txt: "plaintext",
};

export function detectLanguage(filePath: string): FileLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "plaintext";
}

export async function openFile() {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Text Files",
          extensions: [
            "md", "markdown", "mdx", "txt",
            "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",
            "json", "yaml", "yml", "toml",
            "html", "htm", "svelte", "css", "scss",
            "py", "rs", "sh", "bash", "zsh",
            "xml", "svg", "sql", "graphql", "env",
            "gitignore", "dockerfile",
          ],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (typeof selected !== "string") return;

    const filePath = selected;
    const fileName = filePath.split("/").pop() ?? filePath;
    log.info("file", `opening: ${filePath}`);
    const content = await readTextFile(filePath);

    if (content.length > MAX_FILE_SIZE) {
      showToast("File too large to open (max 2 MB)", "warning");
      return;
    }

    const language = detectLanguage(filePath);
    const wsPath = get(activeWorkspacePath);
    addFileTab(fileName, content, language, filePath, wsPath || undefined);
  } catch (e) {
    log.error("file", "failed to open file", e);
    const message = e instanceof Error ? e.message : String(e);
    showToast(`Failed to open file: ${message}`);
  }
}
