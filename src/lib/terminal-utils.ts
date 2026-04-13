import type { PanelData } from "../types/panel";

/** Cheap identity check for panel data: compare version + diff raw string. */
export function panelDataChanged(
  data: PanelData | null,
  lastVersion: number,
  lastDiffRaw: string | null,
): boolean {
  if (!data) return lastVersion !== -1;
  if (data.version !== lastVersion) return true;
  return (data.diff?.raw ?? null) !== lastDiffRaw;
}

/** Parse an OSC 7 URL to extract the CWD path. */
export function parseOsc7Cwd(data: string): string | null {
  try {
    const url = new URL(data);
    return decodeURIComponent(url.pathname) || null;
  } catch {
    const cwd = data.trim();
    return cwd || null;
  }
}
