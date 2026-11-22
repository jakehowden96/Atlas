/**
 * Puts the app's singleton stores back to a blank baseline before each story, so one story's
 * seeded state never shows up in the next. Add a store here when a story starts seeding it.
 */
import { claudeHookStale, claudeMissing } from "../stores/claude";
import { connectors, signIn, signingIn } from "../stores/connectors";
import { openFiles } from "../stores/file-tabs";
import { activeFile, closeRequest, fileWs } from "../stores/files";
import { resetLiveSessions } from "../stores/liveSessions";
import { panelData } from "../stores/panel";
import { prRepos, reposByWorkspace } from "../stores/prs";
import {
  firstRunDismissed,
  railTiles,
  settingsOpen,
  settingsSection,
  watchedRepos,
} from "../stores/settings";
import { notificationLog } from "../stores/toast";
import { activeTabId, permissionPromptTabs, tabs } from "../stores/terminal";
import { tickets } from "../stores/tickets";
import {
  activeView,
  diffOpen,
  fileRailOpen,
  focusedSessionId,
  jumpOpen,
  newSessionOpen,
  openDialogOpen,
  railWidth,
  shortcutsOpen,
} from "../stores/view";
import { activeWorkspacePath, sessionDiffStats, workspaces } from "../stores/workspace";

export function resetStores(): void {
  connectors.set([]);
  prRepos.set(null);
  reposByWorkspace.set({});
  railTiles.set({});
  firstRunDismissed.set(true);
  resetLiveSessions();
  panelData.set(null);
  tabs.set([]);
  activeTabId.set("");
  permissionPromptTabs.set(new Set());
  tickets.set({});
  activeView.set("sessions");
  focusedSessionId.set("");
  diffOpen.set(false);
  railWidth.set("expanded");
  jumpOpen.set(false);
  newSessionOpen.set(false);
  shortcutsOpen.set(false);
  workspaces.set([]);
  activeWorkspacePath.set("");
  sessionDiffStats.set(new Map());
  openFiles.set([]);
  activeFile.set("");
  fileWs.set("");
  watchedRepos.set([]);
  claudeMissing.set(false);
  claudeHookStale.set(false);
  signIn.set({ kind: "idle" });
  signingIn.set(null);
  closeRequest.set(null);
  settingsOpen.set(false);
  settingsSection.set(null);
  openDialogOpen.set(false);
  fileRailOpen.set(true);
  notificationLog.set([]);
}
