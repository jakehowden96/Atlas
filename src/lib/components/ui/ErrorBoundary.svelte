<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { revealLogsDir } from "../../ipc";
  import { log } from "../../logger";
  import Button from "./Button.svelte";
  import CopyButton from "./CopyButton.svelte";
  import EmptyState from "./EmptyState.svelte";

  interface Props {
    /** Names the view in the message and the log line. */
    name: string;
    children: Snippet;
  }

  let { name, children }: Props = $props();

  let version = $state("unknown");
  onMount(() => {
    getVersion()
      .then((v) => (version = v))
      .catch(() => {});
  });

  function details(error: unknown): string {
    const body = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    return `${name}\nAtlas ${version}\n${body}`;
  }
</script>

<svelte:boundary onerror={(error) => log.error("ui", `${name} crashed`, error)}>
  {@render children()}
  {#snippet failed(error, reset)}
    <div class="crash" role="alert">
      <EmptyState
        icon="warning"
        title={`${name} hit a problem`}
        description="The rest of Atlas is still running. Reload this view to try again"
      >
        {#snippet action()}
          <div class="actions">
            <Button variant="primary" onclick={reset}>Reload view</Button>
            <CopyButton variant="text" value={details(error)} label="Copy details" />
            <Button
              onclick={() => revealLogsDir().catch((e) => log.error("ui", "open logs failed", e))}
            >
              Open logs
            </Button>
          </div>
        {/snippet}
      </EmptyState>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .crash {
    display: grid;
    place-items: center;
    height: 100%;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--sp-3);
  }
</style>
