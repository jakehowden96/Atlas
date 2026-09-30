/**
 * The backend events the shell listens to for the life of the app, lifted out
 * of `App.svelte` so their registration order and handlers can be tested.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { get } from "svelte/store";
import {
  type ClaudeNotificationEvent,
  onBackToSessions,
  onClaudeNotification,
  onClaudeSessionStart,
  onPanelUpdate,
  onSessionUpdate,
} from "./ipc";
import { log } from "./logger";
import { shouldNotify } from "./overview";
import { handleClaudeSessionStart } from "./session-actions";
import { filesTouched } from "./session-view";
import { upsertLiveSession } from "./stores/liveSessions";
import { panelData, setSessionTouchedFiles } from "./stores/panel";
import { enableNotifications } from "./stores/settings";
import { activeTabId, setTabNeedsInput } from "./stores/terminal";
import { activeView, showView } from "./stores/view";
import { setSessionDiffStats } from "./stores/workspace";

/** `notification_type`s that block on the user. `idle_prompt` is left out: it
 *  fires when Claude finishes and returns to its prompt, which needs nothing. */
const INPUT_NOTIFICATIONS = ["permission_prompt", "elicitation_dialog"] as const;

async function handleNotification(event: ClaudeNotificationEvent) {
  const { session_id, notification } = event;
  const kind = INPUT_NOTIFICATIONS.find((t) => t === notification.notification_type);
  if (!kind) return;

  setTabNeedsInput(session_id, true, kind);

  if (
    !get(enableNotifications) ||
    !shouldNotify(session_id, get(activeTabId), get(activeView), document.hasFocus())
  ) {
    return;
  }
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({
        title: notification.title || "Claude needs input",
        body: notification.message || "A Claude session is waiting for your response",
      });
    }
  } catch (e) {
    log.warn("app", `notification failed: ${e}`);
  }
}

/**
 * Subscribe to every backend event the shell reacts to. Resolves to a teardown
 * that removes whichever subscriptions succeeded.
 *
 * Nothing slow may run before this: an event that fires while its listener is
 * not yet registered is gone — the hook's needs-input flag, a `/clear` session
 * rotation, a diff badge — and nothing replays it.
 */
export async function registerAppEvents(): Promise<() => void> {
  const results = await Promise.allSettled([
    onPanelUpdate((sessionId, data) => {
      if (sessionId === get(activeTabId)) {
        panelData.set(data);
      }
      // The Files rail asks which sessions have touched the document it is
      // showing, so the per-file counts are kept for every session too.
      setSessionTouchedFiles(sessionId, filesTouched(data));
      // Update diff badge for any session, not just the active one
      if (
        data.diff &&
        (data.diff.files_changed > 0 || data.diff.lines_added > 0 || data.diff.lines_removed > 0)
      ) {
        setSessionDiffStats(sessionId, {
          filesChanged: data.diff.files_changed,
          linesAdded: data.diff.lines_added,
          linesRemoved: data.diff.lines_removed,
        });
      } else {
        setSessionDiffStats(sessionId, null);
      }
    }),
    onSessionUpdate((_sessionUuid, session) => upsertLiveSession(session)),
    onClaudeSessionStart((event) => {
      void handleClaudeSessionStart(event.session_id, event.session_start.claude_session_id);
    }),
    onBackToSessions(() => showView("sessions")),
    onClaudeNotification(handleNotification),
  ]);

  const unlisteners: UnlistenFn[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") unlisteners.push(result.value);
    else log.error("app", "failed to register an event listener", result.reason);
  }
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
