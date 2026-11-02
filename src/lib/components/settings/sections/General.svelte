<script lang="ts">
  import "./shared.css";
  import {
    enableNotifications,
    MAX_TERMINAL_FONT_SIZE,
    MIN_TERMINAL_FONT_SIZE,
    overviewOrdering,
    setEnableNotifications,
    setOverviewOrdering,
    setSoundOnNeedsYou,
    setTerminalFontSize,
    setTheme,
    soundOnNeedsYou,
    terminalFontSize,
    type OverviewOrdering,
  } from "../../../stores/settings";
  import { themeMode, type ThemeMode } from "../../../theme";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import Toggle from "../../ui/Toggle.svelte";

  const APPEARANCE: Segment<ThemeMode>[] = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  const ORDERING: Segment<OverviewOrdering>[] = [
    { id: "attention", label: "Attention" },
    { id: "workspace", label: "Workspace" },
    { id: "manual", label: "Manual" },
    { id: "opened", label: "Opened" },
  ];

  function stepFont(delta: number) {
    void setTerminalFontSize($terminalFontSize + delta);
  }
</script>

<div class="rows sec">
  <div class="row">
    <div class="row-text">
      <div class="row-title">Appearance</div>
      <div class="row-desc">Follows the OS unless you pin one.</div>
    </div>
    <SegmentedControl
      options={APPEARANCE}
      value={$themeMode}
      size="sm"
      onChange={(id) => void setTheme(id)}
    />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">System notifications</div>
      <div class="row-desc">Notify when a session needs you and Atlas isn't focused.</div>
    </div>
    <Toggle
      checked={$enableNotifications}
      label="System notifications"
      onChange={(v) => void setEnableNotifications(v)}
    />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Sound on needs-you</div>
      <div class="row-desc">A short ping when a permission prompt appears.</div>
    </div>
    <Toggle
      checked={$soundOnNeedsYou}
      label="Sound on needs-you"
      onChange={(v) => void setSoundOnNeedsYou(v)}
    />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Terminal font size</div>
      <div class="row-desc">Geist Mono · applies to all sessions.</div>
    </div>
    <div class="stepper">
      <button
        type="button"
        onclick={() => stepFont(-1)}
        disabled={$terminalFontSize <= MIN_TERMINAL_FONT_SIZE}
        aria-label="Smaller terminal font">−</button
      >
      <span class="stepper-value">{$terminalFontSize}</span>
      <button
        type="button"
        onclick={() => stepFont(1)}
        disabled={$terminalFontSize >= MAX_TERMINAL_FONT_SIZE}
        aria-label="Larger terminal font">+</button
      >
    </div>
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Sessions ordering</div>
      <div class="row-desc">Needs-you first, then running, then idle.</div>
    </div>
    <SegmentedControl
      options={ORDERING}
      value={$overviewOrdering}
      size="sm"
      onChange={(id) => void setOverviewOrdering(id)}
    />
  </div>
</div>

<style>
  /* ── Font-size stepper ─────────────────────────────────────────────────── */
  .stepper {
    display: flex;
    align-items: center;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }

  .stepper button {
    height: 100%;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .stepper button:hover:not(:disabled) {
    color: var(--text);
  }

  .stepper button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .stepper-value {
    padding: 0 6px;
    font-variant-numeric: tabular-nums;
  }
</style>
