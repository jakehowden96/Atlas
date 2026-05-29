import { writable } from "svelte/store";
import type { PanelData } from "../../types/panel";

export const panelVisible = writable(true);
export const panelData = writable<PanelData | null>(null);

export function togglePanel() {
  panelVisible.update((v) => !v);
}
