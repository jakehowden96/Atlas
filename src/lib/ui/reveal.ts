import { errorMessage } from "../ipc-error";
import { revealLogsDir, revealPath } from "../ipc";
import { showToast } from "../stores/toast";

/** Show `path` in the OS file manager (or the log folder when omitted); failures become a toast. */
export async function revealInFileManager(path?: string): Promise<void> {
  try {
    await (path === undefined ? revealLogsDir() : revealPath(path));
  } catch (err) {
    showToast("Could not open the file manager", { body: errorMessage(err) });
  }
}
