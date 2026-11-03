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
  import IconButton from "../ui/IconButton.svelte";
  import Kbd from "../ui/Kbd.svelte";
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
        { action: "closeSession" },
        { keys: "Esc", label: "Back to Sessions, unless the terminal has focus" },
        { keys: "E / L", label: "Edit / link the ticket, with the rail focused" },
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
        { keys: "← ↑ → ↓", label: "Move through the file tree" },
        { keys: "F2", label: "Rename the focused file" },
        { keys: "Delete", label: "Delete the focused file" },
        { keys: "⇧F10 / Menu", label: "Open the context menu" },
        { keys: "← →", label: "Move between open file tabs" },
        { keys: "Home / End", label: "First / last file tab" },
        // Only while a tab has focus, so it never meets Close session (⌘⇧W).
        { keys: chord("W"), label: "Close the focused file tab" },
        { keys: ENTER, label: "Follow the focused link in the preview" },
      ],
    },
    {
      title: "Settings",
      rows: [{ keys: chord("F"), label: "Search settings" }],
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

<Modal
  title="Keyboard shortcuts"
  open={$shortcutsOpen}
  onClose={() => shortcutsOpen.set(false)}
  width="720px"
>
  <div class="sheet">
    <div class="head">
      <span class="hint">Rebind the global ones in Settings › Keyboard</span>
      <IconButton
        icon="close"
        size="sm"
        label="Close shortcuts"
        onclick={() => shortcutsOpen.set(false)}
      />
    </div>

    <div class="body">
      {#each GROUPS as group (group.title)}
        <section class="group">
          <h3 class="group-title">{group.title}</h3>
          {#each group.rows as row (labelOf(row) + keysOf(row))}
            <div class="row">
              <span class="keys"><Kbd>{keysOf(row)}</Kbd></span>
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
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-4);
    border-bottom: 1px solid var(--border);
  }

  .hint {
    color: var(--muted);
    font-size: var(--fs-xs);
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
    font-size: var(--fs-2xs);
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
  }

  .what {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
</style>
