<script lang="ts">
  import "./shared.css";
  import type { ClaudeInfo } from "../../../../types/generated/ClaudeInfo";
  import { claudeInfo } from "../../../ipc";
  import { log } from "../../../logger";
  import { showToast } from "../../../stores/toast";
  import {
    claudeHook,
    setClaudeHookEnabled,
    setTailTranscripts,
    settingsOpen,
    tailTranscripts,
  } from "../../../stores/settings";
  import Toggle from "../../ui/Toggle.svelte";
  import { errorMessage } from "../../../ipc-error";

  let claude = $state<ClaudeInfo | null>(null);
  /** Set when `claude_info` itself failed, which is not the same as "not installed". */
  let claudeError = $state(false);

  /** Install or remove the hooks, then refresh the installed badges from the
   *  file itself rather than assuming the change landed. */
  async function setHook(enabled: boolean) {
    try {
      await setClaudeHookEnabled(enabled);
    } catch (e) {
      log.warn(
        "settings",
        `could not ${enabled ? "install" : "remove"} the Claude hooks: ${errorMessage(e)}`,
      );
      showToast(
        enabled
          ? "Could not install the Claude Code hooks"
          : "Could not remove the Claude Code hooks",
        {
          body: errorMessage(e),
        },
      );
    }
    try {
      claude = await claudeInfo();
    } catch (e) {
      log.warn("settings", `claude_info failed: ${errorMessage(e)}`);
    }
  }

  // Fresh every open: the binary can be installed, and the hook written, while
  // Atlas is running.
  $effect(() => {
    if (!$settingsOpen) return;
    claudeError = false;
    claudeInfo()
      .then((info) => (claude = info))
      .catch((e) => {
        claudeError = true;
        log.warn("settings", `claude_info failed: ${errorMessage(e)}`);
      });
  });
</script>

<div class="stack sec">
  <p class="copy">
    Atlas reads Claude Code's own signals — no proxying. Two hooks are installed into <code
      >~/.claude/settings.json</code
    >; everything else comes from tailing the session transcript.
  </p>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Install Atlas's hooks</div>
      <div class="row-desc">
        On by default. Off removes only Atlas's two entries from <code>~/.claude/settings.json</code
        >
        and keeps them out; your own hooks and settings are never touched. Without them a session that
        needs you is not flagged from its prompt, and <code>/clear</code> and
        <code>/compact</code> are not followed.
      </div>
    </div>
    <Toggle checked={$claudeHook} label="Install Atlas's hooks" onChange={(v) => void setHook(v)} />
  </div>

  <div class="list">
    <div class="list-row hook-row">
      <span class="hook-dot" class:on={claude?.notificationHookInstalled}></span>
      <span class="hook-name">Notification</span>
      <span class="hook-desc"> Tells Atlas a session is waiting on a permission prompt. </span>
      <span class="badge" class:on={claude?.notificationHookInstalled}>
        {claude?.notificationHookInstalled ? "installed" : "not installed"}
      </span>
    </div>
    <div class="list-row hook-row">
      <span class="hook-dot" class:on={claude?.sessionStartHookInstalled}></span>
      <span class="hook-name">SessionStart</span>
      <span class="hook-desc">
        Tells Atlas when <code>/clear</code> or <code>/compact</code> moves a session to a new id, so
        the tail follows it.
      </span>
      <span class="badge" class:on={claude?.sessionStartHookInstalled}>
        {claude?.sessionStartHookInstalled ? "installed" : "not installed"}
      </span>
    </div>
  </div>

  <p class="copy">
    Plan, subagents, tool calls and cost are <strong>not</strong> hooks. Atlas derives them by
    tailing <code>~/.claude/projects/**.jsonl</code>, which is why no Stop, PreToolUse, PostToolUse
    or Subagent hooks are installed.
  </p>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Tail transcripts</div>
      <div class="row-desc">
        Read <code>~/.claude/projects/**.jsonl</code> live for context %, tokens, cost and subagents.
        Off stops every running tail; tiles fall back to state and diff counts.
      </div>
    </div>
    <Toggle
      checked={$tailTranscripts}
      label="Tail transcripts"
      onChange={(v) => void setTailTranscripts(v)}
    />
  </div>

  <div class="row">
    <div class="row-text"><div class="row-title">Claude binary</div></div>
    <span class="mono-pill">
      {claude?.binary ??
        (claudeError ? "could not read claude" : "not found on PATH")}{claude?.version
        ? ` · ${claude.version}`
        : ""}
    </span>
  </div>
</div>

<style>
  .hook-row {
    padding: 9px 12px;
  }

  .hook-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--surface3);
  }

  .hook-dot.on {
    background: var(--accent);
  }

  .hook-name {
    width: 130px;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .hook-desc {
    flex: 1;
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
