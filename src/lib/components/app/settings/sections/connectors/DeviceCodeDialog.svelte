<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import type { ConnectorInfo } from "../../../../../../types/generated/ConnectorInfo";
  import { errorMessage } from "../../../../../ipc-error";
  import { openUrl } from "../../../../../ipc";
  import type { SignInState } from "../../../../../stores/connectors";
  import { showToast } from "../../../../../stores/toast";
  import { Button } from "$lib/components/ui/button/index.js";
  import ConnectorLogoTile from "../../../connectors/ConnectorLogoTile.svelte";
  import CopyButton from "../../../common/CopyButton.svelte";
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

  /** The webview cannot open a browser itself (`window.open` and `target=_blank` do nothing), so ask the backend. */
  function openSignIn(url: string) {
    openUrl(url).catch((e) => showToast("Couldn't open the browser", { body: errorMessage(e) }));
  }
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
        <h2 id={titleId}>Connect {connector.name}</h2>
      </div>
      <div class="body">
        {#if progress.kind === "deviceCode"}
          <p class="muted">Enter this code on the sign-in page</p>
          <div class="code-row">
            <span class="code" data-testid="user-code">{progress.userCode}</span>
            <CopyButton value={progress.userCode} label="Copy code" />
          </div>
          <a
            class="link"
            href={progress.verificationUri}
            rel="noreferrer"
            onclick={(e) => {
              e.preventDefault();
              openSignIn(progress.verificationUri);
            }}>{progress.verificationUri}</a
          >
          <Button variant="default" onclick={() => openSignIn(progress.verificationUri)}>
            Open sign-in page
          </Button>
          <div class="wait">
            <span
              class="inline-flex items-center gap-2 text-caption text-muted-foreground"
              role="status"><Spinner />Waiting for you to approve</span
            >
            <span class="clock" class:low={left < 60000} data-testid="countdown">{clock}</span>
          </div>
        {:else if progress.kind === "denied"}
          <Alert.Root variant="destructive" layout="inline"
            ><Icon name="error" /><Alert.Title>Sign-in was denied</Alert.Title></Alert.Root
          >
        {:else if progress.kind === "expired"}
          <Alert.Root variant="warning" layout="inline"
            ><Icon name="warning" /><Alert.Title>The code expired</Alert.Title></Alert.Root
          >
        {:else if progress.kind === "failed"}
          <Alert.Root variant="destructive" layout="inline"
            ><Icon name="error" /><Alert.Title>{progress.reason}</Alert.Title></Alert.Root
          >
        {:else}
          <span
            class="inline-flex items-center gap-2 text-caption text-muted-foreground"
            role="status"
            ><Spinner />{progress.kind === "exchanging"
              ? "Finishing sign-in"
              : "Requesting a code"}</span
          >
        {/if}
      </div>
    </Dialog.Body>
    <Dialog.Footer
      ><Button variant="outline" onclick={onCancel}>Cancel</Button>
      {#if progress.kind === "denied"}
        <Button variant="default" onclick={onRetry}>Try again</Button>
      {:else if progress.kind === "expired"}
        <Button variant="default" onclick={onRetry}>Get a new code</Button>
      {:else if progress.kind === "failed"}
        <Button variant="default" onclick={onRetry}>Retry</Button>
      {/if}</Dialog.Footer
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
  .code-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .code {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    letter-spacing: 0.1em;
  }
  .link {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    word-break: break-all;
  }
  .wait {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .clock {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .clock.low {
    color: var(--warning);
  }
</style>
