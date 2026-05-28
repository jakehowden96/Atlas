import { writable } from "svelte/store";
import type { PanelData } from "../../types/panel";
import { getApiStatus } from "../ipc";
import { log } from "../logger";

export const panelVisible = writable(true);
export const panelData = writable<PanelData | null>(null);
export const apiKeyConfigured = writable(false);

export async function checkApiStatus() {
  try {
    const status = await getApiStatus();
    apiKeyConfigured.set(status);
    log.info("panel", `API key configured: ${status}`);
  } catch (e) {
    log.error("panel", "checkApiStatus failed", e);
  }
}

export function togglePanel() {
  panelVisible.update((v) => !v);
}
