import { writable } from "svelte/store";
import type { PanelData, PanelSection, AnalysisStatus } from "../../types/panel";
import { getApiStatus } from "../ipc";
import { log } from "../logger";

export const panelVisible = writable(true);
export const panelData = writable<PanelData | null>(null);
export const activeSection = writable<PanelSection>("diff");
export const apiKeyConfigured = writable(false);
export const analysisStatus = writable<AnalysisStatus>("idle");
export const analysisError = writable<string | null>(null);

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

export function setSection(section: PanelSection) {
  activeSection.set(section);
}
