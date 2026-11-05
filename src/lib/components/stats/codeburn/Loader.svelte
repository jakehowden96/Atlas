<script lang="ts" generics="T">
  import { untrack, type Snippet } from "svelte";
  import { errorMessage } from "../../../ipc-error";
  import { codeburn } from "../../../stores/codeburn";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import Skeleton from "../../ui/Skeleton.svelte";

  interface Props {
    /** The `codeburn` argv; reloads when it changes. */
    args: string[];
    /** Bumped by the screen's Refresh button to skip the shared cache. */
    refresh?: number;
    children: Snippet<[T]>;
  }

  let { args, refresh = 0, children }: Props = $props();

  let data = $state<T | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let retries = $state(0);
  let seenRefresh = untrack(() => refresh);
  let seenRetries = 0;

  // The previous result stays on screen while the next one loads.
  $effect(() => {
    const argv = args;
    const fresh = refresh !== seenRefresh || retries !== seenRetries;
    seenRefresh = refresh;
    seenRetries = retries;
    let live = true;
    loading = true;
    error = null;
    codeburn<T>(argv, fresh)
      .then((value) => {
        if (live) data = value;
      })
      .catch((e) => {
        if (live) error = errorMessage(e);
      })
      .finally(() => {
        if (live) loading = false;
      });
    return () => {
      live = false;
    };
  });
</script>

{#if error}
  <Banner tone="error" title="Couldn't read codeburn stats">
    {error}
    {#snippet actions()}
      <Button size="sm" onclick={() => retries++}>Retry</Button>
    {/snippet}
  </Banner>
{:else if data === null}
  <Skeleton height="var(--sp-10)" />
{:else}
  <div class="body" class:busy={loading} aria-busy={loading}>
    {@render children(data)}
  </div>
{/if}

<style>
  .busy {
    opacity: 0.6;
    transition: opacity 0.15s;
  }
</style>
