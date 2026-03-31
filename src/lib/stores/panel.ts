import { writable } from "svelte/store";
import type { PanelData, PanelSection } from "../../types/panel";

export const panelVisible = writable(true);
export const panelData = writable<PanelData | null>(null);
export const activeSection = writable<PanelSection>("diff");

export function togglePanel() {
  panelVisible.update((v) => !v);
}

export function setSection(section: PanelSection) {
  activeSection.set(section);
}
