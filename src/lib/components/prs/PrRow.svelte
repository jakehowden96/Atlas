<script lang="ts">
  import { openUrl } from "../../ipc";
  import { errorMessage } from "../../ipc-error";
  import { formatAgo } from "../../format";
  import { checkoutCommand, pillsFor, prStatus } from "../../pr-view";
  import { workOnPr } from "../../session-actions";
  import type { Pr } from "../../stores/prs";
  import { showToast } from "../../stores/toast";
  import Button from "../ui/Button.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import InlineAlert from "../ui/InlineAlert.svelte";
  import StatusMark from "../ui/StatusMark.svelte";
  import PrChecks from "./PrChecks.svelte";

  interface Props {
    repo: string;
    pr: Pr;
    now: number;
    /** The connector's name, for "Open on <provider>". */
    providerName: string;
  }

  let { repo, pr, now, providerName }: Props = $props();

  const uid = $props.id();
  let expanded = $state(false);
  let working = $state(false);
  let failed = $state(false);

  const status = $derived(prStatus(pr));
  const opened = $derived.by(() => {
    const then = Date.parse(pr.createdAt);
    return Number.isNaN(then) ? pr.createdAt : formatAgo(then, now);
  });

  // workOnPr reports its own reasons (dirty tree, no workspace) as toasts and
  // returns false; the row adds the command so the user can retry by hand.
  async function work() {
    working = true;
    failed = false;
    try {
      failed = !(await workOnPr(repo, pr));
    } finally {
      working = false;
    }
  }

  function openPr() {
    openUrl(pr.url).catch((e) => showToast("Failed to open PR", { body: errorMessage(e) }));
  }
</script>

<div class="pr">
  <div class="pr-row">
    <button
      type="button"
      class="toggle"
      aria-expanded={expanded}
      aria-controls="{uid}-checks"
      aria-label="{expanded ? 'Hide' : 'Show'} checks for #{pr.number}"
      onclick={() => (expanded = !expanded)}
    >
      <span class="chev" class:open={expanded}><Icon name="chevron_right" size={16} /></span>
    </button>
    <StatusMark state={status.state} />
    <div class="pr-body">
      <div class="pr-line">
        <span class="status">{status.word}</span>
        <span class="pr-title">{pr.title}</span>
        <span class="pr-number">#{pr.number}</span>
        {#if pr.isDraft}<span class="draft">Draft</span>{/if}
      </div>
      <div class="pr-sub">{pr.headRefName} · opened {opened} · @{pr.author.login}</div>
    </div>
    <div class="pills">
      {#each pillsFor(pr) as pill (pill.label)}
        <span class="pill pill-{pill.tone}">{pill.label}</span>
      {/each}
    </div>
    <Button size="sm" loading={working} onclick={work}>
      {#snippet leading()}<Icon name="terminal" size={16} />{/snippet}
      Work on it
    </Button>
    <IconButton size="sm" icon="open_in_new" label="Open on {providerName}" onclick={openPr} />
  </div>

  {#if failed}
    <div class="fail">
      <InlineAlert>
        Could not check out #{pr.number}. Try it by hand:
        <code>{checkoutCommand(pr)}</code>
      </InlineAlert>
      <CopyButton value={checkoutCommand(pr)} label="Copy command" size="sm" />
      <Button size="sm" variant="ghost" onclick={work}>Retry</Button>
    </div>
  {/if}

  {#if expanded}<PrChecks {pr} id="{uid}-checks" />{/if}
</div>

<style>
  .pr {
    border-bottom: 1px solid var(--border);
  }

  .pr:last-child {
    border-bottom: none;
  }

  .pr-row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-4);
  }

  .pr-row:hover {
    background: var(--hover-bg);
  }

  .toggle {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: var(--h-sm);
    height: var(--h-sm);
    padding: 0;
    border: none;
    border-radius: var(--r-md);
    background: none;
    color: var(--muted);
    cursor: pointer;
  }

  .chev {
    display: grid;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .pr-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-0);
    min-width: 0;
  }

  .pr-line {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }

  .status {
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .pr-title {
    overflow: hidden;
    font-size: var(--fs-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pr-number {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .draft {
    padding: 0 var(--sp-2);
    border: 1px solid var(--border2);
    border-radius: var(--r-pill);
    color: var(--muted);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }

  .pr-sub {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pills {
    display: flex;
    flex-shrink: 0;
    gap: var(--sp-2);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, currentColor 14%, transparent);
    font-size: var(--fs-2xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .pill-accent {
    color: var(--accent);
  }
  .pill-danger {
    color: var(--danger);
  }
  .pill-warn {
    color: var(--warn);
  }
  .pill-muted {
    color: var(--muted);
  }

  .fail {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: 0 var(--sp-4) var(--sp-3) var(--sp-8);
  }

  .fail code {
    font-family: var(--font-mono);
  }
</style>
