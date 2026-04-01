import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { addMarkdownTab } from "./stores/terminal";
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

    if (!selected) return;

    const filePath = typeof selected === "string" ? selected : selected.path;
    const fileName = filePath.split("/").pop() ?? filePath;
    const content = await readTextFile(filePath);
    addMarkdownTab(fileName, content, filePath);
  } catch (e) {
    showToast(`Failed to open file: ${e}`);
  }
}
