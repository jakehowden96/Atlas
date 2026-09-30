import { showToast } from "./stores/toast";
import { errorMessage } from "./ipc-error";

/** Failure classes already announced this run, as `<file>:<action>`. */
const announced = new Set<string>();

/**
 * Tell the user once per run that Atlas's own state file could not be read or
 * written. Silent failure here means lost workspaces or resume ids next launch;
 * repeating the toast on every keystroke-driven write would just be spam.
 */
export function reportStorageFailure(
  file: "settings" | "workspaces",
  action: "load" | "save",
  error: unknown,
): void {
  const id = `${file}:${action}`;
  if (announced.has(id)) return;
  announced.add(id);
  showToast(action === "load" ? `Could not read your ${file}` : `Could not save your ${file}`, {
    body:
      action === "load"
        ? `Starting with defaults. ${errorMessage(error)}`
        : `Changes may be lost when Atlas closes. ${errorMessage(error)}`,
  });
}

/**
 * Tell the user once per run that a state file did not parse and was reset.
 * The backend has already copied the bad file to `<name>.json.bak`, so nothing
 * is lost; this says where.
 */
export function reportStateRecovered(file: "settings" | "workspaces"): void {
  const id = `${file}:recovered`;
  if (announced.has(id)) return;
  announced.add(id);
  showToast(`Your ${file} file could not be read`, {
    body: `Starting from defaults. The unreadable file was kept as ~/.atlas/${file}.json.bak.`,
    type: "warning",
  });
}

/**
 * Tell the user once per run that a state file came from a newer Atlas. This
 * build loads what it understands; the backend keeps the newer file as
 * `<name>.json.v<N>.bak` before the first save replaces it.
 */
export function reportNewerState(file: "settings" | "workspaces"): void {
  const id = `${file}:newer`;
  if (announced.has(id)) return;
  announced.add(id);
  showToast(`Your ${file} were saved by a newer Atlas`, {
    body: `Settings this version does not know are dropped on the next save. The original was kept as ~/.atlas/${file}.json.v<N>.bak.`,
    type: "warning",
  });
}
