<script lang="ts">
  import IconButton from "./IconButton.svelte";

  interface Props {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    label: string;
    disabled?: boolean;
    onChange?: (value: number) => void;
  }

  let {
    value = $bindable(0),
    min = -Infinity,
    max = Infinity,
    step = 1,
    label,
    disabled = false,
    onChange,
  }: Props = $props();

  function set(next: number) {
    const v = Math.min(max, Math.max(min, next));
    if (v === value) return;
    value = v;
    onChange?.(v);
  }

  function onkeydown(e: KeyboardEvent) {
    const moves: Record<string, () => number> = {
      ArrowUp: () => value + step,
      ArrowDown: () => value - step,
      PageUp: () => value + step * 10,
      PageDown: () => value - step * 10,
      Home: () => min,
      End: () => max,
    };
    const move = moves[e.key];
    if (!move || disabled) return;
    const target = move();
    if (Number.isFinite(target)) {
      e.preventDefault();
      set(target);
    }
  }
</script>

<div class="stepper">
  <IconButton
    icon="remove"
    label="Decrease {label}"
    size="sm"
    variant="secondary"
    tabindex={-1}
    disabled={disabled || value <= min}
    onclick={() => set(value - step)}
  />
  <span
    class="value"
    role="spinbutton"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuenow={value}
    aria-valuemin={Number.isFinite(min) ? min : undefined}
    aria-valuemax={Number.isFinite(max) ? max : undefined}
    aria-disabled={disabled ? true : undefined}
    {onkeydown}>{value}</span
  >
  <IconButton
    icon="add"
    label="Increase {label}"
    size="sm"
    variant="secondary"
    tabindex={-1}
    disabled={disabled || value >= max}
    onclick={() => set(value + step)}
  />
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .value {
    min-width: 3ch;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--text);
  }
  .value[aria-disabled="true"] {
    color: var(--disabled-ink);
  }
</style>
