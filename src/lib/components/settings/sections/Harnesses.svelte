<script lang="ts">
  import "./shared.css";
  import { harnesses, setHarnesses, type HarnessConfig } from "../../../stores/settings";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import Toggle from "../../ui/Toggle.svelte";

  const READY_MODE: Segment<HarnessConfig["readyMode"]>[] = [
    { id: "altscreen", label: "Alt-screen" },
    { id: "immediate", label: "Immediate" },
  ];

  /** Which harness's inline form is open. */
  let editingHarnessId = $state<string | null>(null);

  function toggleHarnessEdit(id: string) {
    editingHarnessId = editingHarnessId === id ? null : id;
  }

  function updateHarness(id: string, patch: Partial<HarnessConfig>) {
    void setHarnesses($harnesses.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }

  /** The Settings UI's own limitation: an argument containing a literal space
   *  is not representable this way. None of the built-in harnesses need one. */
  function parseHarnessArgs(text: string): string[] {
    return text.trim().split(/\s+/).filter(Boolean);
  }

  function addHarness() {
    const harness: HarnessConfig = {
      id: crypto.randomUUID(),
      label: "New harness",
      command: "",
      args: [],
      resumable: false,
      readyMode: "altscreen",
    };
    void setHarnesses([...$harnesses, harness]);
    editingHarnessId = harness.id;
  }

  function removeHarness(id: string) {
    if ($harnesses.length <= 1) return;
    void setHarnesses($harnesses.filter((h) => h.id !== id));
    if (editingHarnessId === id) editingHarnessId = null;
  }
</script>

<div class="stack sec">
  <p class="copy">
    What New Session can launch. Claude Code is the only one Atlas can resume — anything else always
    starts fresh.
  </p>
  <div class="list">
    {#each $harnesses as h (h.id)}
      <div class="list-row harness-row">
        <div class="harness-main">
          <div class="harness-head">
            <span class="harness-label">{h.label}</span>
            <span class="badge" class:on={h.resumable}>
              {h.resumable ? "resumable" : "one-shot"}
            </span>
          </div>
          <span class="mono-pill harness-cmd">
            {h.command || "(nothing typed)"}{h.args.length ? ` ${h.args.join(" ")}` : ""}
          </span>
        </div>
        <button type="button" class="key-btn" onclick={() => toggleHarnessEdit(h.id)}>
          {editingHarnessId === h.id ? "Done" : "Edit"}
        </button>
        <button
          type="button"
          class="remove"
          disabled={$harnesses.length <= 1}
          onclick={() => removeHarness(h.id)}
        >
          Remove
        </button>
      </div>
      {#if editingHarnessId === h.id}
        <div class="list-row harness-form">
          <label class="field">
            <span class="field-label">Label</span>
            <input
              class="field-input"
              value={h.label}
              onchange={(e) =>
                updateHarness(h.id, {
                  label: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <label class="field">
            <span class="field-label">Command</span>
            <input
              class="field-input mono"
              value={h.command}
              onchange={(e) =>
                updateHarness(h.id, {
                  command: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <label class="field">
            <span class="field-label">Args</span>
            <input
              class="field-input mono"
              value={h.args.join(" ")}
              onchange={(e) =>
                updateHarness(h.id, {
                  args: parseHarnessArgs((e.currentTarget as HTMLInputElement).value),
                })}
            />
          </label>
          <div class="field">
            <span class="field-label">Resumable</span>
            <Toggle
              checked={h.resumable}
              label="{h.label} resumable"
              onChange={(v) => updateHarness(h.id, { resumable: v })}
            />
          </div>
          <div class="field">
            <span class="field-label">Ready</span>
            <SegmentedControl
              options={READY_MODE}
              value={h.readyMode}
              size="sm"
              onChange={(id) => updateHarness(h.id, { readyMode: id })}
            />
          </div>
        </div>
      {/if}
    {/each}
    <button type="button" class="add-row" onclick={addHarness}>
      <span class="add-glyph"></span>
      Add harness…
    </button>
  </div>
</div>

<style>
  .harness-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 5px;
    min-width: 0;
  }

  .harness-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .harness-label {
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .harness-cmd {
    align-self: flex-start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .harness-form {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    background: var(--bg);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .field-input {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
  }

  .field-input.mono {
    font-family: var(--font-mono);
  }

  .field-input:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
</style>
