<script lang="ts">
  import type { ConnectorState } from "../../../../../types/generated/ConnectorState";
  import Button from "../../../ui/Button.svelte";
  import ConnectorLogoTile from "../../../ui/ConnectorLogoTile.svelte";
  import InlineAlert from "../../../ui/InlineAlert.svelte";
  import StatusMark, { type MarkState } from "../../../ui/StatusMark.svelte";

  interface Props {
    connector: ConnectorState;
    onConnect: () => void;
    onDisconnect: () => void;
  }

  let { connector, onConnect, onDisconnect }: Props = $props();

  const KIND: Record<string, string> = { tickets: "Tickets", pullRequests: "Pull requests" };
  const status = $derived(connector.status);
  const view = $derived.by((): { mark: MarkState; word: string } => {
    switch (status.kind) {
      case "linked":
        return { mark: "done", word: `Linked as ${status.account}` };
      case "reconnectNeeded":
        return { mark: "attention", word: "Reconnect needed" };
      case "error":
        return { mark: "failing", word: `Error: ${status.message}` };
      default:
        return { mark: "idle", word: "Not linked" };
    }
  });
</script>

<div class="row">
  <ConnectorLogoTile connector={connector.info.id} label={connector.info.name} />
  <div class="text">
    <div class="name">{connector.info.name}</div>
    <div class="meta">
      <span>{KIND[connector.info.kind] ?? connector.info.kind}</span>
      <StatusMark state={view.mark} />
      <span data-testid="status-word">{view.word}</span>
    </div>
  </div>
  <div class="actions">
    {#if status.kind === "linked"}
      <Button size="sm" variant="danger" onclick={onDisconnect}>Disconnect</Button>
    {:else if status.kind === "reconnectNeeded"}
      <Button size="sm" variant="primary" onclick={onConnect}>Reconnect</Button>
      <Button size="sm" variant="danger" onclick={onDisconnect}>Disconnect</Button>
    {:else if status.kind === "error"}
      <Button size="sm" variant="primary" onclick={onConnect}>Retry</Button>
      <Button size="sm" variant="danger" onclick={onDisconnect}>Disconnect</Button>
    {:else}
      <Button size="sm" variant="primary" disabled={!connector.info.configured} onclick={onConnect}>
        Connect
      </Button>
    {/if}
  </div>
</div>
{#if !connector.info.configured && status.kind === "notLinked"}
  <InlineAlert tone="warn">Not configured in this build</InlineAlert>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-size: var(--fs-sm);
    font-weight: 500;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: var(--sp-2);
  }
</style>
