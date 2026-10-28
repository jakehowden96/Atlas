import { get } from "svelte/store";
import { ptyWrite } from "../ipc";
import { clearForSession, reviewComments } from "../stores/reviewComments";
import { hasLivePty, tabs } from "../stores/terminal";
import { showToast } from "../stores/toast";
import { formatReviewPrompt, REVIEW_PROMPT_INTRO } from "./formatPrompt";
import { errorMessage } from "../ipc-error";

/**
 * Send one session's pending review comments to its Claude PTY as a single
 * prompt, then clear them.
 *
 * Lifted out of the old `ReviewDrawer.svelte` so the Changes drawer's
 * "Send to Claude" button is the same code path, not a second copy of it, and
 * so the join (session id → tab → pty) is unit-testable without a compiler.
 *
 * `sessionId` is the **terminal tab id** — the key `reviewComments` and
 * `panel-update` are both keyed by, not the Claude session uuid.
 */
export async function submitReview(sessionId: string): Promise<void> {
  if (!sessionId) return;

  const comments = get(reviewComments).get(sessionId) ?? [];
  if (comments.length === 0) return;

  const tab = get(tabs).find((t) => t.id === sessionId);
  if (!hasLivePty(tab)) {
    showToast("Nothing to send", {
      body: "No active Claude terminal to send the review to.",
    });
    return;
  }

  try {
    // Bracketed paste: unmarked bulk input gets split and submitted early.
    await ptyWrite(
      tab.ptyId,
      `${REVIEW_PROMPT_INTRO} \x1b[200~${formatReviewPrompt(comments)}\x1b[201~`,
    );
    // shortcut: fixed delay so Claude Code commits the paste before Enter; raise it if long reviews still submit early
    await new Promise((r) => setTimeout(r, 100));
    await ptyWrite(tab.ptyId, "\r");
    clearForSession(sessionId);
    showToast("Review sent", {
      body: `${comments.length} comment${comments.length === 1 ? "" : "s"} added to the session prompt.`,
      type: "info",
    });
  } catch (e) {
    showToast("Failed to submit review", { body: errorMessage(e) });
  }
}
