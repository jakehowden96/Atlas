<script lang="ts">
  import "./shared.css";
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

  function resetAll() {
    draft = { ...DEFAULT_KEYMAP };
    recording = null;
    void resetKeymap();
  }
</script>

<div class="stack sec">
  <p class="copy">
    Every global chord. ⌘ and Ctrl are interchangeable, so one binding covers both platforms.
    Recording needs the modifier held; Esc cancels. An action can carry a second chord — some chords
    never reach the app, because the OS claims them first.
  </p>

  <div class="list">
    {#each ACTIONS as action (action)}
      <div class="list-row key-row" class:clash={conflicts.includes(action)}>
        <span class="key-name">{ACTION_LABELS[action]}</span>
        <span class="key-chords">
          {#each draft[action] as binding, i (i)}
            <span
              class="mono-pill key-chord"
              class:unreachable={!isReachable(binding)}
              title={isReachable(binding)
                ? undefined
                : "This OS claims this chord — it never reaches Atlas."}
              >{formatBinding(binding)}</span
            >
          {/each}
        </span>
        <button
          type="button"
          class="key-btn"
          class:recording={isRecording(action, 0)}
          onclick={() => (recording = isRecording(action, 0) ? null : { action, index: 0 })}
        >
          {isRecording(action, 0) ? "Press a chord…" : "Record"}
        </button>
        {#if draft[action].length > 1}
          {#if altDroppable(action)}
            <button type="button" class="key-btn" onclick={() => clearAlt(action)}>
              Drop alt
            </button>
          {/if}
        {:else}
          <button
            type="button"
            class="key-btn"
            class:recording={isRecording(action, 1)}
            onclick={() => (recording = isRecording(action, 1) ? null : { action, index: 1 })}
          >
            {isRecording(action, 1) ? "Press a chord…" : "Add alt"}
          </button>
        {/if}
        <button
          type="button"
          class="key-btn"
          onclick={() => applyChords(action, [...DEFAULT_KEYMAP[action]])}
        >
          Reset
        </button>
      </div>
    {/each}
  </div>

  {#if conflicts.length > 0}
    <p class="copy bad">
      Two actions share a chord. Nothing is saved until one of the marked rows changes.
    </p>
  {/if}

  <div class="row">
    <div class="row-text">
      <div class="row-title">Reset all shortcuts</div>
      <div class="row-desc">Puts every chord back to its Atlas default.</div>
    </div>
    <button type="button" class="key-btn" onclick={resetAll}>Reset all</button>
  </div>

  <p class="copy">
    Esc on its own is not rebindable: inside a session it belongs to the Claude Code TUI, and
    everywhere else it closes whatever is open.
    <strong>{formatChord(draft.backToSessions)}</strong> is the way back to Sessions from a focused terminal.
  </p>
</div>

<style>
  .key-row {
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
    min-width: 74px;
    text-align: center;
  }

  /* Shown, because it is what is bound, but never promised: the OS takes this
     one before Atlas sees it. */
  .key-chord.unreachable {
    opacity: 0.5;
    text-decoration: line-through;
  }

  .key-row.clash .key-chord {
    border-color: var(--danger);
    color: var(--danger);
  }

  .key-btn.recording {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
