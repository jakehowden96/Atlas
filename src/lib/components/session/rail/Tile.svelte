<script lang="ts">
  import type { Snippet } from "svelte";
  import { tileOpen, type TileState } from "../../../session-view";
  import { railTiles, setRailTile, type RailTiles } from "../../../stores/settings";
  import Icon from "../../ui/Icon.svelte";
  import StatusMark from "../../ui/StatusMark.svelte";

  interface Props {
    key: keyof RailTiles;
    /** The run-in label before the headline: Plan, Agents, PR. */
    label: string;
    state: TileState;
    /** Receives whether the tile is open, since the open headline differs. */
    headline: Snippet<[boolean]>;
    /** The collapsed line under the headline. */
    detail?: Snippet;
    children: Snippet;
  }

  let { key, label, state, headline, detail, children }: Props = $props();

  let open = $derived(tileOpen(state, $railTiles[key]));
  let bodyId = $derived(`rail-tile-${key}`);
</script>

<section class="tile" class:failing={state === "failing"} class:attention={state === "attention"} data-tile={key}>
  <button
    type="button"
    class="head"
    aria-expanded={open}
    aria-controls={bodyId}
    onclick={() => void setRailTile(key, !open)}
  >
    <span class="mark"><StatusMark {state} /></span>
    <span class="headline"><span class="label">{label}</span>{@render headline(open)}</span>
    <span></span>
    <span class="twisty" class:open><Icon name="chevron_right" /></span>
  </button>
  {#if !open && detail}
    <div class="detail">{@render detail()}</div>
  {/if}
  {#if open}
    <div class="body" id={bodyId}>{@render children()}</div>
  {/if}
</section>

<style>
  .tile {
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-card-lg);
    background: var(--surface);
  }

  .tile.failing {
    border-color: var(--danger);
  }

  .tile.attention {
    border-color: var(--warn);
  }

  .head {
    display: grid;
    grid-template-columns: 10px 1fr auto 16px;
    column-gap: 10px;
    align-items: start;
    width: 100%;
    padding: 10px 14px;
    border: 0;
    border-radius: var(--r-card-lg);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    line-height: 20px;
    text-align: left;
    cursor: pointer;
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
  }

  .label {
    margin-right: 8px;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .twisty {
    display: flex;
    align-items: center;
    height: 20px;
    color: var(--muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .twisty.open {
    transform: rotate(90deg);
  }

  .detail {
    padding: 0 14px 12px 34px;
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 18px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .body {
    display: grid;
    gap: 14px;
    padding: 0 14px 14px;
  }
</style>
