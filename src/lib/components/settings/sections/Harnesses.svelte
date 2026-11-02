<script lang="ts">
  import "./shared.css";
  import {
    harnesses,
    removeHarnessWithUndo,
    setHarnesses,
    type HarnessConfig,
  } from "../../../stores/settings";
  import { errorMessage } from "../../../ipc-error";
  import Button from "../../ui/Button.svelte";
  import Field from "../../ui/Field.svelte";
  import Input from "../../ui/Input.svelte";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import Toggle from "../../ui/Toggle.svelte";

  const READY_MODE: Segment<HarnessConfig["readyMode"]>[] = [
    { id: "altscreen", label: "Alt-screen" },
    { id: "immediate", label: "Immediate" },
  ];

  /** Which harness's inline form is open. */
  let editingHarnessId = $state<string | null>(null);
  /** The field that just saved (shows the tick for 2s) and per-field errors. */
  let savedKey = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  function toggleHarnessEdit(id: string) {
    editingHarnessId = editingHarnessId === id ? null : id;
  }

  async function updateHarness(id: string, field: string, patch: Partial<HarnessConfig>) {
    const key = `${id}:${field}`;
    try {
      await setHarnesses($harnesses.map((h) => (h.id === id ? { ...h, ...patch } : h)));
      errors[key] = "";
      savedKey = key;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (savedKey = null), 2100);
    } catch (e) {
      errors[key] = `Could not save: ${errorMessage(e)}`;
    }
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
    if (editingHarnessId === id) editingHarnessId = null;
    void removeHarnessWithUndo(id);
  }
</script>

<div class="stack sec">
  <p class="copy">
    What New session can launch. Claude Code is the only one Atlas can resume. Anything else always
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
        <Button size="sm" onclick={() => toggleHarnessEdit(h.id)}>
          {editingHarnessId === h.id ? "Done" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={$harnesses.length <= 1}
          title={$harnesses.length <= 1 ? "Keep at least one harness" : undefined}
          onclick={() => removeHarness(h.id)}
        >
          Remove
        </Button>
      </div>
      {#if editingHarnessId === h.id}
        <div class="list-row harness-form">
          <Field label="Label" error={errors[`${h.id}:label`]} saved={savedKey === `${h.id}:label`}>
            {#snippet children(c)}
              <Input
                id={c.id}
                aria-describedby={c["aria-describedby"]}
                invalid={c.invalid}
                value={h.label}
                oncommit={(v) => v !== h.label && updateHarness(h.id, "label", { label: v })}
              />
            {/snippet}
          </Field>
          <Field
            label="Command"
            error={errors[`${h.id}:command`]}
            saved={savedKey === `${h.id}:command`}
          >
            {#snippet children(c)}
              <Input
                id={c.id}
                aria-describedby={c["aria-describedby"]}
                invalid={c.invalid}
                mono
                value={h.command}
                oncommit={(v) => v !== h.command && updateHarness(h.id, "command", { command: v })}
              />
            {/snippet}
          </Field>
          <Field label="Args" error={errors[`${h.id}:args`]} saved={savedKey === `${h.id}:args`}>
            {#snippet children(c)}
              <Input
                id={c.id}
                aria-describedby={c["aria-describedby"]}
                invalid={c.invalid}
                mono
                value={h.args.join(" ")}
                oncommit={(v) =>
                  v.trim() !== h.args.join(" ") &&
                  updateHarness(h.id, "args", { args: parseHarnessArgs(v) })}
              />
            {/snippet}
          </Field>
          <div class="field">
            <span class="field-label">Resumable</span>
            <Toggle
              checked={h.resumable}
              label="{h.label} resumable"
              onChange={(v) => updateHarness(h.id, "resumable", { resumable: v })}
            />
            {#if errors[`${h.id}:resumable`]}<span class="field-err"
                >{errors[`${h.id}:resumable`]}</span
              >{/if}
          </div>
          <div class="field">
            <span class="field-label">Ready</span>
            <SegmentedControl
              options={READY_MODE}
              value={h.readyMode}
              size="sm"
              onChange={(id) => updateHarness(h.id, "readyMode", { readyMode: id })}
            />
            {#if errors[`${h.id}:readyMode`]}<span class="field-err"
                >{errors[`${h.id}:readyMode`]}</span
              >{/if}
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

  .field-err {
    color: var(--danger);
    font-size: var(--fs-2xs);
  }
</style>
