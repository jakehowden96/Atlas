import type { DiffData } from "../types/generated/DiffData";
import type { PanelData } from "../types/generated/PanelData";
import { formatBytes } from "./format";

const encoder = new TextEncoder();

/** Which of the drawer's two diffs is on screen. */
export type BaseView = "working" | "main";

/**
 * The banner text for a diff the backend cut to its size cap, or null when
 * everything is shown. Without it a capped diff reads as a complete one: the
 * files after the cut are simply absent.
 */
export function truncationNotice(diff: DiffData | null | undefined, view: BaseView): string | null {
  if (!diff) return null;

  if (diff.projects?.length) {
    let shownFiles = 0;
    let totalFiles = 0;
    let shownBytes = 0;
    let anyCut = false;
    for (const project of diff.projects) {
      const cut = project.truncated;
      if (cut) anyCut = true;
      shownFiles += cut?.shown_files ?? project.files_changed;
      totalFiles += cut?.total_files ?? project.files_changed;
      shownBytes += cut?.shown_bytes ?? encoder.encode(project.raw).length;
    }
    return anyCut ? describe(shownFiles, totalFiles, shownBytes) : null;
  }

  const cut = view === "working" && diff.local_raw ? diff.local_truncated : diff.truncated;
  return cut ? describe(cut.shown_files, cut.total_files, cut.shown_bytes) : null;
}

function describe(shownFiles: number, totalFiles: number, shownBytes: number): string {
  return `diff truncated - ${shownFiles} of ${totalFiles} files (${formatBytes(shownBytes)} shown)`;
}

/**
 * What the Changes drawer says when there are no files to show. "Working tree
 * clean" would be a lie on a machine with no git, where nothing was checked.
 */
export function emptyDiffMessage(panel: PanelData | null, isMac: boolean): string {
  if (panel?.issue === "git_not_found") {
    const install = isMac ? "xcode-select --install" : "winget install --id Git.Git";
    return `git was not found on PATH. Install it (${install}), then reopen this panel.`;
  }
  return "Working tree clean";
}
