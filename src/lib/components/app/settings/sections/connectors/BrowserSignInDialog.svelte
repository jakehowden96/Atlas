<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import type { ConnectorInfo } from "../../../../../../types/generated/ConnectorInfo";
  import type { SignInState } from "../../../../../stores/connectors";
  import { Button } from "$lib/components/ui/button/index.js";
  import ConnectorLogoTile from "../../../connectors/ConnectorLogoTile.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";

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

<Dialog.Root
  open
  onOpenChange={(o) => {
    if (!o) onCancel();
  }}
>
  <Dialog.Content size="sm" aria-labelledby={titleId}>
    <Dialog.Body>
      <div class="head">
        <ConnectorLogoTile connector={connector.id} label={connector.name} />
        <h2 id={titleId}>Finish in your browser</h2>
      </div>
      <div class="body">
        {#if outcome}
          <Alert.Root variant="destructive" layout="inline"
            ><Icon name="error" /><Alert.Title>{outcome}</Alert.Title></Alert.Root
          >
        {:else}
          <p class="muted">Sign in to {connector.name} in the window that just opened</p>
          <span
            class="inline-flex items-center gap-2 text-caption text-muted-foreground"
            role="status"
            ><Spinner />{progress.kind === "exchanging"
              ? "Finishing sign-in"
              : "Waiting for your browser"}</span
          >
        {/if}
      </div>
    </Dialog.Body>
    <Dialog.Footer
      ><Button variant="outline" onclick={onCancel}>Cancel</Button>
      {#if outcome}<Button variant="default" onclick={onRetry}>Retry</Button>{/if}</Dialog.Footer
    >
  </Dialog.Content>
</Dialog.Root>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5) 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
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
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
