import { get } from "svelte/store";
import { ptyWrite } from "../ipc";
import { clearForSession, reviewComments } from "../stores/reviewComments";
import { tabs } from "../stores/terminal";
import { showToast } from "../stores/toast";
import { formatReviewPrompt } from "./formatPrompt";

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
  if (!tab || tab.ptyId < 0) {
    showToast("Nothing to send", {
      body: "No active Claude terminal to send the review to.",
    });
    return;
  }

  try {
    const prompt = formatReviewPrompt(comments);
    // Trailing CR submits Claude's input line. If Claude is mid-turn,
    // Claude Code's own terminal queues the line until it's ready.
    await ptyWrite(tab.ptyId, prompt + "\r");
    clearForSession(sessionId);
    showToast("Review sent", {
      body: `${comments.length} comment${comments.length === 1 ? "" : "s"} added to the session prompt.`,
      type: "info",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast("Failed to submit review", { body: msg });
  }
}
