import { writeTextFile } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { get } from "svelte/store";
import { tabs, activeTabId, markFileSaved } from "./stores/terminal";
import { showToast } from "./stores/toast";
import { log } from "./logger";

export async function saveActiveFile() {
  const id = get(activeTabId);
  const tabList = get(tabs);
  const tab = tabList.find((t) => t.id === id);
  if (!tab || tab.type !== "file") return;

  let filePath = tab.filePath;

  if (!filePath) {
    const selected = await save({
      defaultPath: tab.title,
      filters: [{ name: "All Files", extensions: ["*"] }],
    });
    if (!selected) return;
    filePath = selected;
  }

  try {
    log.info("file", `saving: ${filePath}`);
    await writeTextFile(filePath, tab.content);
    markFileSaved(id, tab.filePath ? undefined : filePath);
    showToast("File saved", "info");
  } catch (e) {
    log.error("file", `failed to save: ${filePath}`, e);
    const message = e instanceof Error ? e.message : String(e);
    showToast(`Failed to save: ${message}`);
  }
}
