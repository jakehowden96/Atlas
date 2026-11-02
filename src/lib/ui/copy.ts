import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { log } from "../logger";

/** Copies text to the clipboard. Resolves false on failure; never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      log.error("copy", "clipboard write failed", e);
      return false;
    }
  }
}
