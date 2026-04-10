import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { get } from "svelte/store";
import { addMarkdownTab } from "./stores/terminal";
import { activeWorkspacePath } from "./stores/workspace";
import { showToast } from "./stores/toast";

export async function openMarkdownFile() {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Markdown",
          extensions: ["md", "markdown", "mdx"],
        },
      ],
    });

    if (typeof selected !== "string") return;

    const filePath = selected;
    const fileName = filePath.split("/").pop() ?? filePath;
    const content = await readTextFile(filePath);
    const wsPath = get(activeWorkspacePath);
    addMarkdownTab(fileName, content, filePath, wsPath || undefined);
  } catch (e) {
    showToast(`Failed to open file: ${e}`);
  }
}
