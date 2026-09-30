import { showToast } from "./stores/toast";

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
        ? `Starting with defaults. ${String(error)}`
        : `Changes may be lost when Atlas closes. ${String(error)}`,
  });
}
