<script lang="ts">
  interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
  }

  let { checked, onChange, label, disabled = false }: Props = $props();
</script>

<button
  type="button"
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onChange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    position: relative;
    flex-shrink: 0;
    width: 32px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--r-pill);
    background: var(--surface3);
    box-shadow: inset 0 0 0 1px var(--border2);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .toggle.on {
    background: var(--accent);
    box-shadow: none;
  }

  .toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .toggle.on .knob {
    background: var(--accent-ink);
    transform: translateX(14px);
  }
</style>
