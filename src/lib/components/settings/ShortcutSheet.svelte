<script lang="ts">
  /**
   * Every chord Atlas answers, on one sheet, grouped by the screen it belongs
   * to.
   *
   * The global rows read `$chords`, so a rebound chord is listed as it is bound
   * rather than as it shipped — a sheet that lies about a binding is worse than
   * no sheet. The per-screen rows are literals because those keys are not in
   * the keymap at all: they are the arrows, ⏎ and Esc the screens handle
   * themselves, and nothing can rebind them.
   */
  import { ACTION_LABELS, type Action } from "../../keymap";
  import { chord, enterLabel } from "../../platform";
  import { chords } from "../../stores/settings";
  import { shortcutsOpen } from "../../stores/view";
  import Modal from "../ui/Modal.svelte";

  /** A row is either a keymap action or a chord this screen fixes itself. */
  type Row = { action: Action } | { keys: string; label: string };

  interface Group {
    title: string;
    rows: Row[];
  }

  const ENTER = enterLabel();

  const GROUPS: Group[] = [
    {
      title: "Anywhere",
      rows: [
        { action: "newSession" },
        { action: "jump" },
        { action: "settings" },
        { action: "shortcuts" },
        { action: "tab1" },
        { action: "tab2" },
        { action: "tab3" },
        { action: "tab4" },
        { action: "backToSessions" },
      ],
    },
    {
      title: "Sessions",
      rows: [
        { keys: "← ↑ → ↓", label: "Move between tiles" },
        { keys: "↑", label: "From the top row, up to the workspace filter" },
        { keys: "Home / End", label: "First / last tile" },
        { keys: ENTER, label: "Open the focused session" },
        { keys: "Y / N", label: "Allow / deny on a tile that needs you" },
      ],
    },
    {
      title: "Session",
      rows: [
        { action: "toggleRail" },
        { keys: "Esc", label: "Back to Sessions, unless the terminal has focus" },
      ],
    },
    {
      title: "Changes",
      rows: [
        { keys: "↑ ↓", label: "Move the cursor through a file's diff" },
        { keys: `${ENTER} / Space`, label: "Comment on the line under the cursor" },
        { keys: chord(ENTER), label: "Save the comment being written" },
        { keys: "Esc", label: "Cancel the comment, then close the drawer" },
      ],
    },
    {
      title: "Files",
      rows: [
        { action: "saveFile" },
        { action: "openFile" },
        { keys: ENTER, label: "Follow the focused link in the preview" },
      ],
    },
    {
      title: "New session",
      rows: [
        { keys: "Tab", label: "Switch between New and Resume" },
        { keys: "⇧← ⇧→", label: "Move between the columns" },
        { keys: "↑ ↓", label: "Move within a column" },
        { keys: ENTER, label: "Start the session" },
      ],
    },
    {
      title: "Jump to…",
      rows: [
        { keys: "↑ ↓", label: "Move through the results" },
        { keys: ENTER, label: "Open the selected row" },
        { keys: "Esc", label: "Close the palette" },
      ],
    },
  ];

  function keysOf(row: Row): string {
    return "action" in row ? $chords[row.action] : row.keys;
  }

  function labelOf(row: Row): string {
    return "action" in row ? ACTION_LABELS[row.action] : row.label;
  }
</script>

<Modal open={$shortcutsOpen} onClose={() => shortcutsOpen.set(false)} width="720px">
  <div class="sheet">
    <div class="head">
      Keyboard shortcuts
      <span class="hint">Rebind the global ones in Settings › Keyboard</span>
      <div class="spacer"></div>
      <button
        type="button"
        class="close"
        aria-label="Close shortcuts"
        onclick={() => shortcutsOpen.set(false)}>✕</button
      >
    </div>

    <div class="body">
      {#each GROUPS as group (group.title)}
        <section class="group">
          <h3 class="group-title">{group.title}</h3>
          {#each group.rows as row (labelOf(row) + keysOf(row))}
            <div class="row">
              <span class="keys">{keysOf(row)}</span>
              <span class="what">{labelOf(row)}</span>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>
</Modal>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 140px);
  }

  .head {
    display: flex;
    align-items: baseline;
    flex-shrink: 0;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    font-weight: 600;
  }

  .hint {
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 400;
  }

  .spacer {
    flex: 1;
  }

  .close {
    align-self: center;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface2);
    color: var(--text);
  }

  /* Two columns of groups, so the whole sheet is one screenful without a
     scroll on a normal window. It still scrolls when it has to. */
  .body {
    columns: 2;
    column-gap: 26px;
    padding: 14px 16px 16px;
    overflow-y: auto;
  }

  .group {
    break-inside: avoid;
    margin-bottom: 14px;
  }

  .group-title {
    margin-bottom: 5px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 2.5px 0;
  }

  .keys {
    flex-shrink: 0;
    min-width: 78px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .what {
    color: var(--muted);
    font-size: 12px;
  }
</style>
