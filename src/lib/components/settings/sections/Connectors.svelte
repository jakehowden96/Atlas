<script lang="ts">
  import "./shared.css";
  import { cancel, connect, connectors, disconnect, signIn } from "../../../stores/connectors";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import BrowserSignInDialog from "./connectors/BrowserSignInDialog.svelte";
  import ConnectorRow from "./connectors/ConnectorRow.svelte";
  import DeviceCodeDialog from "./connectors/DeviceCodeDialog.svelte";

  let activeId = $state<string | null>(null);
  const active = $derived($connectors.find((c) => c.info.id === activeId)?.info ?? null);

  function start(id: string) {
    activeId = id;
    void connect(id);
  }

  function close() {
    if (activeId) void cancel(activeId);
    activeId = null;
  }

  // Idle after a dialog opened means the sign-in finished or was cancelled.
  $effect(() => {
    if ($signIn.kind === "idle") activeId = null;
  });

  async function remove(id: string, name: string) {
    const ok = await confirmAction({
      title: `Disconnect ${name}?`,
      body: `${name} stops updating in Atlas. Your watched repositories are kept.`,
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
      onDisconnect={() => void remove(c.info.id, c.info.name)}
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
