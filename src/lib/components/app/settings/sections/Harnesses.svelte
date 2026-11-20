<script lang="ts">
  import "./shared.css";
  import {
    harnesses,
    removeHarnessWithUndo,
    setHarnesses,
    type HarnessConfig,
  } from "../../../../stores/settings";
  import { errorMessage } from "../../../../ipc-error";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Segmented, { type Segment } from "$lib/components/app/common/Segmented.svelte";
  import { Switch } from "$lib/components/ui/switch/index.js";

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

<!-- A text setting that commits on blur or Enter, with its error and a 2s saved tick. -->
{#snippet textField(
  key: string,
  label: string,
  value: string,
  mono: boolean,
  commit: (v: string) => void,
)}
  <Field.Field data-invalid={errors[key] ? true : undefined}>
    <div class="flex items-center justify-between gap-2">
      <Field.Label for={key}>{label}</Field.Label>
      <Field.Saved saved={savedKey === key} />
    </div>
    <Input
      id={key}
      {mono}
      {value}
      aria-invalid={errors[key] ? true : undefined}
      aria-describedby={errors[key] ? `${key}-error` : undefined}
      onblur={(e) => commit(e.currentTarget.value)}
      onkeydown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
    />
    {#if errors[key]}<Field.Error id="{key}-error">{errors[key]}</Field.Error>{/if}
  </Field.Field>
{/snippet}

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
        <Button variant="outline" size="sm" onclick={() => toggleHarnessEdit(h.id)}>
          {editingHarnessId === h.id ? "Done" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={$harnesses.length <= 1}
          title={$harnesses.length <= 1 ? "Keep at least one harness" : undefined}
          onclick={() => removeHarness(h.id)}
        >
          Remove
        </Button>
      </div>
      {#if editingHarnessId === h.id}
        <div class="list-row harness-form">
          {@render textField(`${h.id}:label`, "Label", h.label, false, (v) => {
            if (v !== h.label) void updateHarness(h.id, "label", { label: v });
          })}
          {@render textField(`${h.id}:command`, "Command", h.command, true, (v) => {
            if (v !== h.command) void updateHarness(h.id, "command", { command: v });
          })}
          {@render textField(`${h.id}:args`, "Args", h.args.join(" "), true, (v) => {
            if (v.trim() !== h.args.join(" "))
              void updateHarness(h.id, "args", { args: parseHarnessArgs(v) });
          })}
          <div class="field">
            <span class="field-label">Resumable</span>
            <Switch
              checked={h.resumable}
              onCheckedChange={(v) => updateHarness(h.id, "resumable", { resumable: v })}
              aria-label="{h.label} resumable"
            />
            {#if errors[`${h.id}:resumable`]}<span class="field-err"
                >{errors[`${h.id}:resumable`]}</span
              >{/if}
          </div>
          <div class="field">
            <span class="field-label">Ready</span>
            <Segmented
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
    font-family: var(--font-sans);
    font-size: var(--text-sm);
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
    background: var(--background);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    color: var(--muted-foreground);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .field-err {
    color: var(--destructive);
    font-size: var(--text-xs);
  }
</style>
