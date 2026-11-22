<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import { onMount } from "svelte";
  import { connectors } from "../../../../stores/connectors";
  import { openSettings } from "../../../../stores/settings";
  import { linkTicket, retry, tickets } from "../../../../stores/tickets";
  import { normalizeTicketId, suggestTicketId } from "../../../../tickets";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";

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
      aria-invalid={invalid || st?.kind === "notFound" ? true : undefined}
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
    <Alert.Root variant="destructive" layout="inline"
      ><Icon name="error" /><Alert.Title>Use a ticket ID like ABC-123</Alert.Title></Alert.Root
    >
  {:else if st?.kind === "loading"}
    <span class="inline-flex items-center gap-2 text-caption text-muted-foreground" role="status"
      ><Spinner />Looking up ticket</span
    >
  {:else if st?.kind === "notFound"}
    <Alert.Root variant="destructive" layout="inline"
      ><Icon name="error" /><Alert.Title>No ticket {normalizeTicketId(value)} found</Alert.Title
      ></Alert.Root
    >
  {:else if st?.kind === "unauthorized"}
    <Alert.Root variant="warning" layout="inline"
      ><Icon name="warning" /><Alert.Title>{name} needs you to sign in again</Alert.Title
      ></Alert.Root
    >
    <Button variant="link" onclick={() => openSettings("connectors")}>Reconnect →</Button>
  {:else if st?.kind === "offline"}
    <Alert.Root variant="warning" layout="inline"
      ><Icon name="warning" /><Alert.Title>You are offline</Alert.Title></Alert.Root
    >
    <Button variant="link" onclick={() => void retry(sessionId)}>Retry</Button>
  {:else if st?.kind === "noConnector"}
    <Alert.Root variant="warning" layout="inline"
      ><Icon name="warning" /><Alert.Title>Link {name} to show tickets</Alert.Title></Alert.Root
    >
  {:else if st?.kind === "error"}
    <Alert.Root variant="destructive" layout="inline"
      ><Icon name="error" /><Alert.Title>{st.message}</Alert.Title></Alert.Root
    >
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
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--card);
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    cursor: pointer;
  }
  .suggest span {
    color: var(--muted-foreground);
    font-family: var(--font-sans);
  }
  .hint {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
</style>
