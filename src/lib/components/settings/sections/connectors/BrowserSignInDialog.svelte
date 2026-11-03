<script lang="ts">
  import type { ConnectorInfo } from "../../../../../types/generated/ConnectorInfo";
  import type { SignInState } from "../../../../stores/connectors";
  import Button from "../../../ui/Button.svelte";
  import ConnectorLogoTile from "../../../ui/ConnectorLogoTile.svelte";
  import InlineAlert from "../../../ui/InlineAlert.svelte";
  import Modal from "../../../ui/Modal.svelte";
  import Spinner from "../../../ui/Spinner.svelte";

  interface Props {
    connector: ConnectorInfo;
    progress: SignInState;
    onCancel: () => void;
    onRetry: () => void;
  }

  let { connector, progress, onCancel, onRetry }: Props = $props();
  const titleId = $derived(`bsd-${connector.id}`);
  const outcome = $derived(
    progress.kind === "failed"
      ? progress.reason
      : progress.kind === "denied"
        ? "Sign-in was denied"
        : progress.kind === "expired"
          ? "Sign-in timed out"
          : null,
  );
</script>

<Modal open onClose={onCancel} width="420px" labelledBy={titleId}>
  <div class="head">
    <ConnectorLogoTile connector={connector.id} label={connector.name} />
    <h2 id={titleId}>Finish in your browser</h2>
  </div>
  <div class="body">
    {#if outcome}
      <InlineAlert>{outcome}</InlineAlert>
    {:else}
      <p class="muted">Sign in to {connector.name} in the window that just opened</p>
      <Spinner
        label={progress.kind === "exchanging" ? "Finishing sign-in" : "Waiting for your browser"}
      />
    {/if}
  </div>
  {#snippet footer()}
    <Button onclick={onCancel}>Cancel</Button>
    {#if outcome}<Button variant="primary" onclick={onRetry}>Retry</Button>{/if}
  {/snippet}
</Modal>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5) 0;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-3);
    padding: var(--sp-5);
  }
  .muted {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
