<script lang="ts">
  import { tick } from "svelte";
  import { openUrl } from "../../../ipc";
  import { connectors } from "../../../stores/connectors";
  import { prRepos, prsForTicket } from "../../../stores/prs";
  import { openSettings } from "../../../stores/settings";
  import { retry, tickets, unlinkTicket } from "../../../stores/tickets";
  import Button from "../../ui/Button.svelte";
  import ConnectorLogo from "../../ui/ConnectorLogo.svelte";
  import MenuButton from "../../ui/MenuButton.svelte";
  import Spinner from "../../ui/Spinner.svelte";
  import TicketEditor from "./TicketEditor.svelte";

  let {
    sessionId,
    branch = "",
    branchLine,
  }: { sessionId: string; branch?: string; branchLine: string } = $props();

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

<div class="ticket" class:stale bind:this={root}>
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
    <Spinner label="Loading ticket" />
  {:else if unlinked || st.kind === "noConnector"}
    <div class="none">Link {providerName} to show tickets</div>
    <Button size="sm" onclick={() => openSettings("connectors")}>Link →</Button>
  {:else if entry?.link}
    <div class="head"><span class="id">{entry.link.id}</span></div>
    <div class="none">Couldn't load this ticket</div>
    <Button size="sm" onclick={() => void retry(sessionId)}>Retry</Button>
  {:else}
    <div class="none">No ticket linked</div>
    <Button size="sm" data-trigger onclick={() => (editing = true)}>Link ticket</Button>
  {/if}
  {#if branchLine}<div class="branch">{branchLine}</div>{/if}
</div>

<style>
  .ticket {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 134px;
    padding: 16px 16px 14px;
    background: var(--surface2);
  }
  .ticket.stale {
    box-shadow: inset 0 0 0 1px var(--warn);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .id {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
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
    font-size: var(--fs-xs);
  }
  .prs li {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  .pr-title {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip {
    padding: 0 8px;
    border: 1px solid var(--muted);
    border-radius: var(--r-pill);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .chip.inProgress,
  .chip.done {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.inReview {
    border-color: var(--warn);
    color: var(--warn);
  }
  .title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    font-size: var(--fs-lg);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .title.dim {
    opacity: 0.6;
  }
  .note,
  .none {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .branch {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
</style>
