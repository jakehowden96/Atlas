<script lang="ts">
  interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
  }

  let { checked, onChange, label }: Props = $props();
</script>

<button
  type="button"
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
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
    border-radius: 9px;
    background: var(--surface3);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .toggle.on {
    background: var(--accent);
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    /* Keeps the knob legible against --surface3 in the off state. */
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease;
  }

  .toggle.on .knob {
    transform: translateX(14px);
  }
</style>
