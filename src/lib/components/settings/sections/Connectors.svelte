<script lang="ts">
  import "./shared.css";
  import {
    cancel,
    connect,
    connectors,
    disconnect,
    signIn,
    signingIn,
  } from "../../../stores/connectors";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import BrowserSignInDialog from "./connectors/BrowserSignInDialog.svelte";
  import ConnectorRow from "./connectors/ConnectorRow.svelte";
  import DeviceCodeDialog from "./connectors/DeviceCodeDialog.svelte";

  // Set by `connect`, so a reconnect started from a status chip shows its dialog here too.
  const active = $derived($connectors.find((c) => c.info.id === $signingIn)?.info ?? null);

  function start(id: string) {
    void connect(id);
  }

  function close() {
    if ($signingIn) void cancel($signingIn);
    signingIn.set(null);
  }

  // Idle after a dialog opened means the sign-in finished or was cancelled.
  $effect(() => {
    if ($signIn.kind === "idle") signingIn.set(null);
  });

  async function remove(id: string, name: string, kind: string) {
    const ok = await confirmAction({
      title: `Disconnect ${name}?`,
      body:
        kind === "pullRequests"
          ? `${name} stops updating in Atlas. Your watched repositories are kept.`
          : `${name} stops updating in Atlas.`,
      confirmLabel: "Disconnect",
    });
    if (ok) await disconnect(id);
  }
</script>

<div class="stack sec">
  <p class="copy">Link the services Atlas reads tickets and pull requests from</p>
  {#each $connectors as c (c.info.id)}
    <ConnectorRow
      connector={c}
      onConnect={() => start(c.info.id)}
      onDisconnect={() => void remove(c.info.id, c.info.name, c.info.kind)}
    />
  {/each}
</div>

{#if active}
  {#if active.flow === "deviceCode"}
    <DeviceCodeDialog
      connector={active}
      progress={$signIn}
      onCancel={close}
      onRetry={() => start(active.id)}
    />
  {:else}
    <BrowserSignInDialog
      connector={active}
      progress={$signIn}
      onCancel={close}
      onRetry={() => start(active.id)}
    />
  {/if}
{/if}
