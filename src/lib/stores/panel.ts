import { writable } from "svelte/store";
import type { PanelData, PanelSection } from "../../types/panel";
import { getApiStatus } from "../ipc";

export const panelVisible = writable(true);
export const panelData = writable<PanelData | null>(null);
export const activeSection = writable<PanelSection>("diff");
export const apiKeyConfigured = writable(false);

export async function checkApiStatus() {
  const status = await getApiStatus();
  apiKeyConfigured.set(status);
}

export function togglePanel() {
  panelVisible.update((v) => !v);
}

export function setSection(section: PanelSection) {
  activeSection.set(section);
}
