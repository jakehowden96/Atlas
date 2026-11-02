<script module lang="ts">
  import type { TileState } from "../../../session-view";

  export interface ThinMark {
    key: "plan" | "agents" | "pr";
    /** The letters beside the mark: P, A, PR. */
    letter: string;
    state: TileState;
    /** The full sentence: accessible name and tooltip. */
    sentence: string;
  }
</script>

<script lang="ts">
  import { tooltip } from "../../../ui/tooltip";
  import StatusMark from "../../ui/StatusMark.svelte";

  interface Props {
    marks: ThinMark[];
    waiting: boolean;
    /** The ticket ID, or "" for none. */
    ticketId: string;
    onexpand: (key: ThinMark["key"]) => void;
  }

  let { marks, waiting, ticketId, onexpand }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  function onkeydown(e: KeyboardEvent, i: number) {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    buttons[(i + step + marks.length) % marks.length]?.focus();
  }
</script>

<div class="thin">
  <div class="band">
    {#if waiting}
      <StatusMark state="attention" label="Waiting for you" />
    {/if}
    <span class="ticket">{ticketId || "no ticket"}</span>
  </div>
  <div class="marks" role="toolbar" aria-label="Activity rail" aria-orientation="vertical">
    {#each marks as mark, i (mark.key)}
      <button
        bind:this={buttons[i]}
        type="button"
        class="mark"
        data-tile={mark.key}
        aria-label={mark.sentence}
        use:tooltip={{ text: mark.sentence, side: "left", delay: 0 }}
        onclick={() => onexpand(mark.key)}
        onkeydown={(e) => onkeydown(e, i)}
      >
        <StatusMark state={mark.state} />
        <span class="letter">{mark.letter}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .thin {
    display: flex;
    flex-direction: column;
    width: 48px;
    height: 100%;
  }

  .band {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 12px 0;
    background: var(--surface2);
  }

  .ticket {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 600;
    transform: rotate(180deg);
    white-space: nowrap;
    writing-mode: vertical-rl;
  }

  .marks {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 0;
  }

  .mark {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 40px;
    padding: 6px 0;
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--muted);
    cursor: pointer;
  }

  .mark:hover {
    background: var(--hover-bg);
    color: var(--text);
  }

  .letter {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 600;
  }
</style>
