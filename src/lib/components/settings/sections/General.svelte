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
  import NumberStepper from "../../ui/NumberStepper.svelte";
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
      role="radiogroup"
      label="Appearance"
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
      <div class="row-desc">Geist Mono, applies to all sessions.</div>
    </div>
    <NumberStepper
      value={$terminalFontSize}
      min={MIN_TERMINAL_FONT_SIZE}
      max={MAX_TERMINAL_FONT_SIZE}
      label="Terminal font size"
      onChange={(v) => void setTerminalFontSize(v)}
    />
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
      role="radiogroup"
      label="Sessions ordering"
      onChange={(id) => void setOverviewOrdering(id)}
    />
  </div>
</div>
