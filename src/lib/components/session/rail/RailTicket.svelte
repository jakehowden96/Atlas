<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { openUrl } from "../../../ipc";
  import { connectors } from "../../../stores/connectors";
  import { prRepos, prsForTicket } from "../../../stores/prs";
  import { openSettings } from "../../../stores/settings";
  import { retry, tickets, unlinkTicket } from "../../../stores/tickets";
  import { Button } from "$lib/components/ui/button/index.js";
  import ConnectorLogo from "../../app/connectors/ConnectorLogo.svelte";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import MenuButton from "../../app/common/MenuButton.svelte";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import TicketEditor from "./TicketEditor.svelte";

  let {
    sessionId,
    branch = "",
    branchLine,
    actions,
  }: { sessionId: string; branch?: string; branchLine: string; actions?: Snippet } = $props();

  let editing = $state(false);
  let root = $state<HTMLElement>();

  const entry = $derived($tickets[sessionId]);
  const st = $derived(entry?.state ?? { kind: "none" as const });
  const connector = $derived(
    $connectors.find((c) => c.info.id === entry?.link?.connectorId) ??
      $connectors.find((c) => c.info.kind === "tickets"),
  );
  const providerName = $derived(connector?.info.name ?? "tickets");
  const shown = $derived(st.kind === "ready" ? st.ticket : (entry?.last ?? null));
  const stale = $derived(!!shown && st.kind !== "ready" && st.kind !== "loading");
  const unlinked = $derived(!entry?.link && connector?.status.kind !== "linked");
  // Nothing to show: only the bar's link button, no card.
  const compact = $derived(!editing && !shown && st.kind !== "loading" && !entry?.link);
  const noService = $derived(unlinked || st.kind === "noConnector");
  // PRs in watched repos that already name this ticket.
  const ticketPrs = $derived(prsForTicket($prRepos, shown?.id ?? entry?.link?.id ?? ""));

  const items = $derived([
    { id: "change", label: "Change", shortcut: "E" },
    { id: "open", label: `Open in ${providerName}` },
    { id: "copy", label: "Copy ID" },
    { id: "unlink", label: "Unlink", danger: true },
  ]);

  async function close() {
    editing = false;
    await tick();
    root?.querySelector<HTMLElement>("[data-trigger]")?.focus();
  }

  function onselect(item: { id: string }) {
    if (item.id === "change") editing = true;
    else if (item.id === "open" && shown) void openUrl(shown.url);
    else if (item.id === "copy" && shown) void navigator.clipboard?.writeText(shown.id);
    else if (item.id === "unlink") void unlinkTicket(sessionId);
  }

  function onwindowkeydown(e: KeyboardEvent) {
    if (editing || e.metaKey || e.ctrlKey || e.altKey || !root) return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]"))
      return;
    if (!root.closest(".rail")?.contains(document.activeElement)) return;
    const k = e.key.toLowerCase();
    if ((k === "e" && shown) || (k === "l" && !shown && !unlinked)) {
      e.preventDefault();
      editing = true;
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div bind:this={root}>
  <div class="bar">
    <span class="branch">{branchLine}</span>
    {#if compact}
      <TooltipButton
        icon="confirmation_number"
        data-trigger
        label={noService ? `Connect ${providerName} to link tickets` : "Link ticket"}
        onclick={() => (noService ? openSettings("connectors") : (editing = true))}
      />
    {/if}
    {@render actions?.()}
  </div>
  {#if !compact}
    <div class="ticket" class:stale>
      {#if editing}
        <TicketEditor
          {sessionId}
          {branch}
          initial={entry?.link?.id ?? ""}
          onclose={() => void close()}
        />
      {:else if shown}
        <div class="head">
          <ConnectorLogo connector={connector?.info.id ?? ""} size={16} />
          <span class="id">{shown.id}</span>
          <span class="chip {shown.statusKind}">{shown.status}</span>
          <span class="menu">
            <MenuButton icon="more_horiz" label="Ticket actions" {items} {onselect} align="end" />
          </span>
        </div>
        <div class="title" class:dim={stale}>{shown.title}</div>
        {#if ticketPrs.length > 0}
          <ul class="prs" aria-label="Pull requests for {shown.id}">
            {#each ticketPrs as { repo, pr } (pr.url)}
              <li>
                <Button variant="link" onclick={() => void openUrl(pr.url)}
                  >{repo}#{pr.number}</Button
                >
                <span class="pr-title">{pr.title}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if stale}
          <div class="note">
            couldn't refresh · <Button variant="link" onclick={() => void retry(sessionId)}
              >Retry</Button
            >
          </div>
        {/if}
      {:else if st.kind === "loading"}
        <span class="inline-flex items-center gap-2 text-caption text-muted-foreground" role="status"><Spinner />Loading ticket</span>
      {:else if entry?.link}
        <div class="head"><span class="id">{entry.link.id}</span></div>
        <div class="none">Couldn't load this ticket</div>
        <Button variant="outline" size="sm" onclick={() => void retry(sessionId)}>Retry</Button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ticket {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 134px;
    padding: 16px 16px 14px;
    background: var(--muted);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 4px 8px 4px 16px;
  }
  .bar .branch {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ticket.stale {
    box-shadow: inset 0 0 0 1px var(--warning);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .id {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .menu {
    margin-left: auto;
  }
  .prs {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-caption);
  }
  .prs li {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  .pr-title {
    overflow: hidden;
    color: var(--muted-foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip {
    padding: 0 8px;
    border: 1px solid var(--muted-foreground);
    border-radius: var(--radius-full);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .chip.inProgress,
  .chip.done {
    border-color: var(--success);
    color: var(--success);
  }
  .chip.inReview {
    border-color: var(--warning);
    color: var(--warning);
  }
  .title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    font-size: var(--text-lg);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .title.dim {
    opacity: 0.6;
  }
  .note,
  .none {
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }
  .branch {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
</style>
