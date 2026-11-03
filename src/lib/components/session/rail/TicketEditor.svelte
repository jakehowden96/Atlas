<script lang="ts">
  import { onMount } from "svelte";
  import { connectors } from "../../../stores/connectors";
  import { openSettings } from "../../../stores/settings";
  import { linkTicket, retry, tickets } from "../../../stores/tickets";
  import { normalizeTicketId, suggestTicketId } from "../../../tickets";
  import Button from "../../ui/Button.svelte";
  import InlineAlert from "../../ui/InlineAlert.svelte";
  import Input from "../../ui/Input.svelte";
  import Spinner from "../../ui/Spinner.svelte";

  let {
    sessionId,
    branch,
    initial = "",
    onclose,
  }: { sessionId: string; branch: string; initial?: string; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let value = $state(initial);
  let invalid = $state(false);
  let submitted = $state(false);
  let box = $state<HTMLElement>();

  const suggestion = $derived(suggestTicketId(branch));
  const st = $derived(submitted ? $tickets[sessionId]?.state : undefined);
  const name = $derived($connectors.find((c) => c.info.kind === "tickets")?.info.name ?? "tickets");

  onMount(() => box?.querySelector("input")?.focus());

  async function submit() {
    if (!normalizeTicketId(value)) {
      invalid = true;
      return;
    }
    invalid = false;
    submitted = true;
    await linkTicket(sessionId, value);
    if ($tickets[sessionId]?.state.kind === "ready") onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Tab" && !e.shiftKey && !value && suggestion) {
      e.preventDefault();
      value = suggestion;
    }
  }
</script>

<form class="editor" aria-label="Link ticket" onsubmit={(e) => e.preventDefault()}>
  <div bind:this={box} role="presentation" {onkeydown}>
    <Input
      bind:value
      mono
      invalid={invalid || st?.kind === "notFound"}
      placeholder="ABC-123"
      aria-label="Ticket ID"
      disabled={st?.kind === "loading"}
    />
  </div>
  {#if suggestion && !value}
    <button type="button" class="suggest" onclick={() => (value = suggestion)}>
      {suggestion} <span>from branch</span>
    </button>
  {/if}
  {#if invalid}
    <InlineAlert>Use a ticket ID like ABC-123</InlineAlert>
  {:else if st?.kind === "loading"}
    <Spinner label="Looking up ticket" />
  {:else if st?.kind === "notFound"}
    <InlineAlert>No ticket {normalizeTicketId(value)} found</InlineAlert>
  {:else if st?.kind === "unauthorized"}
    <InlineAlert tone="warn">{name} needs you to sign in again</InlineAlert>
    <Button variant="link" onclick={() => openSettings("connectors")}>Reconnect →</Button>
  {:else if st?.kind === "offline"}
    <InlineAlert tone="warn">You are offline</InlineAlert>
    <Button variant="link" onclick={() => void retry(sessionId)}>Retry</Button>
  {:else if st?.kind === "noConnector"}
    <InlineAlert tone="warn">Link {name} to show tickets</InlineAlert>
  {:else if st?.kind === "error"}
    <InlineAlert>{st.message}</InlineAlert>
  {/if}
  <div class="hint">Enter to link, Esc to cancel</div>
</form>

<style>
  .editor {
    display: grid;
    gap: var(--sp-2);
  }
  .suggest {
    justify-self: start;
    padding: 0 var(--sp-2);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .suggest span {
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .hint {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
