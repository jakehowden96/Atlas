<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { tooltip } from "../../ui/tooltip";
  import Icon,{ type IconName } from "./Icon.svelte";

  interface Props extends Omit<HTMLButtonAttributes, "children" | "aria-label"> {
    icon: IconName;
    /** Becomes aria-label; required because there is no visible text. */
    label: string;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
  }

  let { icon, label, variant = "ghost", size = "md", type = "button", ...rest }: Props = $props();
</script>

<button {...rest} {type} class="ib {variant} {size}" aria-label={label} use:tooltip={{ text: label }}>
  <Icon name={icon} size={size === "sm" ? 16 : 18} />
</button>

<style>
  .ib {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .sm {
    width: var(--h-sm);
    height: var(--h-sm);
    border-radius: var(--r-md);
  }
  .md {
    width: var(--h-md);
    height: var(--h-md);
    border-radius: var(--r-lg);
  }
  .lg {
    width: var(--h-lg);
    height: var(--h-lg);
    border-radius: var(--r-lg);
  }
  .primary {
    background: var(--ink);
    color: var(--ink-text);
  }
  .primary:hover {
    background: var(--ink-hover-bg);
  }
  .secondary {
    background: var(--surface);
    border-color: var(--border2);
    color: var(--text);
  }
  .secondary:hover {
    background: var(--hover-bg);
  }
  .ghost {
    background: transparent;
    color: var(--muted);
  }
  .ghost:hover {
    background: var(--hover-bg);
    color: var(--text);
  }
  .danger {
    background: var(--surface);
    border-color: var(--border2);
    color: var(--danger);
  }
  .danger:hover {
    border-color: var(--danger);
  }
  .secondary:active,
  .ghost:active {
    background: var(--active-bg);
  }
  .ib:disabled {
    background: var(--disabled-bg);
    border-color: var(--disabled-border);
    color: var(--disabled-ink);
    cursor: default;
  }
</style>
