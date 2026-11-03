<script lang="ts">
  import type { ConnectorInfo } from "../../../../../types/generated/ConnectorInfo";
  import type { SignInState } from "../../../../stores/connectors";
  import Button from "../../../ui/Button.svelte";
  import ConnectorLogoTile from "../../../ui/ConnectorLogoTile.svelte";
  import CopyButton from "../../../ui/CopyButton.svelte";
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

  let now = $state(Date.now());
  $effect(() => {
    if (progress.kind !== "deviceCode") return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const left = $derived(progress.kind === "deviceCode" ? Math.max(0, progress.expiresAt - now) : 0);
  const clock = $derived(
    `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`,
  );
  const titleId = $derived(`dcd-${connector.id}`);
</script>

<Modal open onClose={onCancel} width="420px" labelledBy={titleId}>
  <div class="head">
    <ConnectorLogoTile connector={connector.id} label={connector.name} />
    <h2 id={titleId}>Connect {connector.name}</h2>
  </div>
  <div class="body">
    {#if progress.kind === "deviceCode"}
      <p class="muted">Enter this code on the sign-in page</p>
      <div class="code-row">
        <span class="code" data-testid="user-code">{progress.userCode}</span>
        <CopyButton value={progress.userCode} label="Copy code" />
      </div>
      <a class="link" href={progress.verificationUri} target="_blank" rel="noreferrer"
        >{progress.verificationUri}</a
      >
      <Button variant="primary" onclick={() => window.open(progress.verificationUri, "_blank")}>
        Open sign-in page
      </Button>
      <div class="wait">
        <Spinner label="Waiting for you to approve" />
        <span class="clock" class:low={left < 60000} data-testid="countdown">{clock}</span>
      </div>
    {:else if progress.kind === "denied"}
      <InlineAlert>Sign-in was denied</InlineAlert>
    {:else if progress.kind === "expired"}
      <InlineAlert tone="warn">The code expired</InlineAlert>
    {:else if progress.kind === "failed"}
      <InlineAlert>{progress.reason}</InlineAlert>
    {:else}
      <Spinner label={progress.kind === "exchanging" ? "Finishing sign-in" : "Requesting a code"} />
    {/if}
  </div>
  {#snippet footer()}
    <Button onclick={onCancel}>Cancel</Button>
    {#if progress.kind === "denied"}
      <Button variant="primary" onclick={onRetry}>Try again</Button>
    {:else if progress.kind === "expired"}
      <Button variant="primary" onclick={onRetry}>Get a new code</Button>
    {:else if progress.kind === "failed"}
      <Button variant="primary" onclick={onRetry}>Retry</Button>
    {/if}
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
  .code-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .code {
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    letter-spacing: 0.1em;
  }
  .link {
    font-size: var(--fs-xs);
    color: var(--muted);
    word-break: break-all;
  }
  .wait {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .clock {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .clock.low {
    color: var(--warn);
  }
</style>
