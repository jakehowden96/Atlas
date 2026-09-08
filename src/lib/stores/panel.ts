import { writable } from "svelte/store";
import type { PanelData } from "../../types/panel";

export const panelData = writable<PanelData | null>(null);
