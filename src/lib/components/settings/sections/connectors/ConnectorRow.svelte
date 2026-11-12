<script lang="ts">
  import type { AuthMethod } from "../../../../../types/generated/AuthMethod";
  import type { ConnectorState } from "../../../../../types/generated/ConnectorState";
  import { linkCli } from "../../../../stores/connectors";
  import Button from "../../../ui/Button.svelte";
  import ConnectorLogoTile from "../../../ui/ConnectorLogoTile.svelte";
  import InlineAlert from "../../../ui/InlineAlert.svelte";
  import SegmentedControl from "../../../ui/SegmentedControl.svelte";
  import StatusMark, { type MarkState } from "../../../ui/StatusMark.svelte";
  import ApiKeyForm from "./ApiKeyForm.svelte";

  interface Props {
    connector: ConnectorState;
    /** Start the OAuth sign-in. */
    onConnect: () => void;
    onDisconnect: () => void;
  }

  let { connector, onConnect, onDisconnect }: Props = $props();

  const KIND: Record<string, string> = { tickets: "Tickets", pullRequests: "Pull requests" };
  const info = $derived(connector.info);
  const status = $derived(connector.status);
  const label = (m: AuthMethod) =>
    m === "oauth" ? `Sign in with ${info.name}` : m === "cli" ? `${info.name} CLI` : "API key";

  // The picker shows the linked method until the user picks another; nothing
  // changes until that method's own action succeeds.
  let picked = $state<AuthMethod | null>(null);
  const choice = $derived(picked ?? connector.method ?? info.methods[0] ?? "oauth");
  /** The picked method is the one linked (or needing a reconnect). */
  const current = $derived(status.kind !== "notLinked" && choice === connector.method);
  const inUse = $derived(current && status.kind === "linked");

  const view = $derived.by((): { mark: MarkState; word: string } => {
    switch (status.kind) {
      case "linked": {
        const via =
          connector.method && info.methods.length > 1 ? ` · ${label(connector.method)}` : "";
        return { mark: "done", word: `Linked as ${status.account}${via}` };
      }
      case "reconnectNeeded":
        return { mark: "attention", word: "Reconnect needed" };
      default:
        return { mark: "idle", word: "Not linked" };
    }
  });

  /** The line under the picker; none while the picked method is in use. */
  const note = $derived.by((): { text: string; warn: boolean } => {
    if (current && status.kind === "reconnectNeeded") return { text: status.reason, warn: true };
    if (choice === "cli") {
      return { text: `Uses the account the ${info.name} CLI is signed in with.`, warn: false };
    }
    if (!info.configured) return { text: "Not configured in this build", warn: true };
    return { text: `Opens ${info.name} in your browser.`, warn: false };
  });

  // Picking a method is choosing to use it: act at once where nothing more is
  // needed from the user. An API key still has to be pasted.
  function pick(m: AuthMethod) {
    if (m === choice) return;
    picked = m;
    cliError = null;
    if (m === "cli") void useCli();
    else if (m === "oauth" && info.configured) onConnect();
  }

  let busy = $state(false);
  let cliError = $state<string | null>(null);

  async function useCli() {
    busy = true;
    cliError = null;
    try {
      await linkCli(info.id);
      picked = null;
    } catch (e) {
      cliError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="row">
  <ConnectorLogoTile connector={info.id} label={info.name} />
  <div class="text">
    <div class="name">{info.name}</div>
    <div class="meta">
      <span>{KIND[info.kind] ?? info.kind}</span>
      <StatusMark state={view.mark} />
      <span data-testid="status-word">{view.word}</span>
    </div>
  </div>
  {#if status.kind !== "notLinked"}
    <Button size="sm" variant="danger" onclick={onDisconnect}>Disconnect</Button>
  {/if}
</div>

<div class="signin">
  {#if info.methods.length > 1}
    <div class="picker">
      <SegmentedControl
        role="radiogroup"
        size="sm"
        label={`How ${info.name} signs in`}
        options={info.methods.map((m) => ({ id: m, label: label(m) }))}
        value={choice}
        onChange={pick}
      />
    </div>
  {/if}
  {#if inUse}
    <!-- Nothing to do: the picked method is the one in use. -->
  {:else if choice === "apiKey"}
    <ApiKeyForm connector={info} onLinked={() => (picked = null)} />
  {:else}
    <div class="line">
      <span class="note" class:warn={note.warn}>{note.text}</span>
      {#if choice === "cli"}
        <Button size="sm" variant="primary" disabled={busy} onclick={useCli}
          >{busy
            ? "Checking…"
            : current
              ? "Reconnect"
              : cliError
                ? "Try again"
                : `Use ${info.name} CLI`}</Button
        >
      {:else}
        <Button
          size="sm"
          variant="primary"
          disabled={!info.configured}
          onclick={() => {
            picked = null;
            onConnect();
          }}>{current ? "Reconnect" : "Connect"}</Button
        >
      {/if}
    </div>
  {/if}
  {#if cliError}<InlineAlert>{cliError}</InlineAlert>{/if}
</div>

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
  /* Indented past the logo, in line with the watched repositories below. */
  .signin {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding-left: calc(var(--sp-3) + 32px);
  }
  .picker {
    display: flex;
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    /* The API key input's height, so every method's line is the same. */
    min-height: var(--h-md);
  }
  .note {
    font-size: var(--fs-xs);
    line-height: 1.45;
    color: var(--muted);
  }
  .note.warn {
    color: var(--warn);
  }
</style>
