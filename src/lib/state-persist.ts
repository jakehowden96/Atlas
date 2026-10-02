import type { StateFile } from "../types/generated/StateFile";
import { stateSave } from "./ipc";

export interface StatePersister {
  /**
   * Ask for the current snapshot to be written. Requests made while a write is
   * in flight are folded into one follow-up write of the latest snapshot, so at
   * most one `state_save` is ever outstanding and the last request always wins.
   * Resolves once the write that covers this request has finished; a failed
   * write goes to `onError` rather than rejecting.
   *
   * Before `markLoaded`, the request is remembered and resolves at once: the
   * write happens as soon as the load settles, and never ahead of it.
   */
  request(): Promise<void>;
  /** The initial load has settled (whether or not it succeeded). */
  markLoaded(): void;
}

/**
 * Serialised, coalescing persistence for one of Atlas's state files.
 *
 * `snapshot` is read when the write starts, not when it was requested, which
 * is what makes coalescing latest-wins.
 */
export function createStatePersister(
  name: StateFile,
  snapshot: () => unknown,
  onError: (error: unknown) => void,
): StatePersister {
  let loaded = false;
  let dirty = false;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    // Always yield once, so `running` is assigned before this can finish.
    await Promise.resolve();
    try {
      while (dirty) {
        dirty = false;
        try {
          await stateSave(name, JSON.stringify(snapshot(), null, 2));
        } catch (e) {
          onError(e);
        }
      }
    } finally {
      running = null;
    }
  }

  return {
    request() {
      dirty = true;
      if (!loaded) return Promise.resolve();
      running ??= drain();
      return running;
    },
    markLoaded() {
      loaded = true;
      if (dirty) running ??= drain();
    },
  };
}
