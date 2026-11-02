<script lang="ts">
  import "./shared.css";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import InlineAlert from "../../ui/InlineAlert.svelte";
  import Kbd from "../../ui/Kbd.svelte";
  import StatusMark from "../../ui/StatusMark.svelte";
  import Tooltip from "../../ui/Tooltip.svelte";
  import { get } from "svelte/store";
  import {
    ACTION_LABELS,
    ACTIONS,
    DEFAULT_KEYMAP,
    findConflicts,
    formatBinding,
    formatChord,
    isReachable,
    mergeKeymap,
    parseBindingFromEvent,
    type Action,
    type Binding,
    type Keymap,
  } from "../../../keymap";
  import { keymap, resetKeymap, setKeymap, settingsOpen } from "../../../stores/settings";

  /* The keymap is edited as a draft so a clash can be shown before it is
     saved. A conflicting draft is simply never persisted. */
  let draft = $state<Keymap>({ ...get(keymap) });
  /** Which chord slot is listening: index 0 is the action's primary, 1 its
   *  alternate. Null when nothing is being recorded. */
  let recording = $state<{ action: Action; index: number } | null>(null);

  let conflicts = $derived(findConflicts(draft));

  // A fresh draft on every open, so an abandoned conflict does not linger.
  $effect(() => {
    if (!$settingsOpen) return;
    draft = { ...get(keymap) };
    recording = null;
  });

  function isRecording(action: Action, index: number): boolean {
    return recording?.action === action && recording.index === index;
  }

  /* Captured on the window in the capture phase, so the chord being recorded
     does not also fire its own action on the way past. */
  $effect(() => {
    if (recording === null) return;
    // Read out of the closure: `recording` is reassigned by the handler itself,
    // and TypeScript cannot narrow a mutable binding captured this way.
    const { action, index } = recording;
    function onKeydown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        recording = null;
        return;
      }
      const binding = parseBindingFromEvent(e);
      // Null is a bare modifier or a chord without ⌘/Ctrl — keep listening.
      if (!binding) return;
      const bindings = [...draft[action]];
      bindings[index] = binding;
      applyChords(action, bindings);
      recording = null;
    }
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  });

  function applyChords(action: Action, bindings: Binding[]) {
    const next = { ...draft, [action]: bindings };
    draft = next;
    // Refuse the save while two actions share a chord; both rows are marked.
    if (findConflicts(next).length > 0) return;
    void setKeymap(next);
  }

  /** Drop an action's alternate, leaving its primary alone. */
  function clearAlt(action: Action) {
    const primary = draft[action][0];
    if (primary) applyChords(action, [primary]);
  }

  /** Whether dropping the alternate would still be there after a restart.
   *  `mergeKeymap` restores an alternate the defaults ship with when the stored
   *  list is only a subset of them, so for those the button would lie. */
  function altDroppable(action: Action): boolean {
    const primary = draft[action][0];
    return !!primary && mergeKeymap({ [action]: [primary] })[action].length === 1;
  }

  async function confirmReset() {
    const ok = await confirmAction({
      title: "Reset all shortcuts",
      body: "Every chord goes back to its default",
      confirmLabel: "Reset all",
    });
    if (ok) resetAll();
  }

  function resetAll() {
    draft = { ...DEFAULT_KEYMAP };
    recording = null;
    void resetKeymap();
  }
</script>

<div class="stack sec">
  {#if conflicts.length > 0}
    <Banner tone="warn" title="Two actions share a chord. Nothing is saved until one changes" />
  {/if}

  <p class="copy">
    Command and Ctrl both work, so one chord covers Mac and Windows. Hold a modifier while
    recording. Esc cancels.
  </p>

  <div class="list">
    {#each ACTIONS as action (action)}
      {@const clash = conflicts.includes(action)}
      <div class="list-row key-row" class:clash>
        <span class="key-name">{ACTION_LABELS[action]}</span>
        <span class="key-chords">
          {#each draft[action] as binding, i (i)}
            {#if isReachable(binding)}
              <Kbd>{formatBinding(binding)}</Kbd>
            {:else}
              <Tooltip text="Your system uses this chord, so Atlas never sees it">
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <span
                  class="key-chord"
                  tabindex="0"
                  role="group"
                  aria-label="{formatBinding(binding)}, not available"
                >
                  <StatusMark state="attention" label="Not available" />
                  <Kbd>{formatBinding(binding)}</Kbd>
                </span>
              </Tooltip>
            {/if}
          {/each}
        </span>
        <Button
          size="sm"
          onclick={() => (recording = isRecording(action, 0) ? null : { action, index: 0 })}
        >
          {isRecording(action, 0) ? "Press a chord…" : "Record"}
        </Button>
        {#if draft[action].length > 1}
          {#if altDroppable(action)}
            <Button size="sm" onclick={() => clearAlt(action)}>Drop alt</Button>
          {/if}
        {:else}
          <Button
            size="sm"
            onclick={() => (recording = isRecording(action, 1) ? null : { action, index: 1 })}
          >
            {isRecording(action, 1) ? "Press a chord…" : "Add alt"}
          </Button>
        {/if}
        <Button size="sm" onclick={() => applyChords(action, [...DEFAULT_KEYMAP[action]])}>
          Reset
        </Button>
        {#if clash}
          <InlineAlert tone="error">Another action uses this chord</InlineAlert>
        {/if}
      </div>
    {/each}
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Reset all shortcuts</div>
      <div class="row-desc">Put every chord back to its default</div>
    </div>
    <Button size="sm" onclick={confirmReset}>Reset all</Button>
  </div>

  <p class="copy">
    Esc can't be changed. It closes whatever is open, and inside a session it goes to Claude Code.
    Use <Kbd>{formatChord(draft.backToSessions)}</Kbd> to leave a focused terminal.
  </p>
</div>

<style>
  .key-row {
    flex-wrap: wrap;
    padding: 8px 12px;
  }

  .key-name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }

  .key-chords {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
  }

  .key-chord {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
  }
</style>
