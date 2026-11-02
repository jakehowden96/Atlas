<script module lang="ts">
  export type MarkState = "running" | "failing" | "attention" | "done" | "idle";
</script>

<script lang="ts">
  interface Props {
    state: MarkState;
    /** Overrides the shape's default size in px. */
    size?: number;
    /** Gives the mark an accessible name; without it the mark is decorative. */
    label?: string;
  }

  let { state, size, label }: Props = $props();
</script>

<span
  class="mark {state}"
  style:--mark-size={size ? `${size}px` : undefined}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
></span>

<style>
  .mark {
    display: inline-block;
    flex: none;
    box-sizing: border-box;
  }

  .running {
    width: var(--mark-size, 8px);
    height: var(--mark-size, 8px);
    border-radius: 50%;
    background: var(--accent);
    animation: var(--pulse);
  }

  .failing {
    width: var(--mark-size, 7px);
    height: var(--mark-size, 7px);
    background: var(--danger);
    transform: rotate(45deg);
  }

  .attention {
    width: var(--mark-size, 10px);
    height: calc(var(--mark-size, 10px) * 0.9);
    background: var(--warn);
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }

  .done {
    width: var(--mark-size, 8px);
    height: var(--mark-size, 8px);
    border-radius: 50%;
    border: 1.5px solid var(--muted);
  }

  .idle {
    width: var(--mark-size, 4px);
    height: var(--mark-size, 4px);
    border-radius: 50%;
    background: var(--muted);
  }
</style>
