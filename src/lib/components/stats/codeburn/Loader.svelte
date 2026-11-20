<script lang="ts" generics="T">
  import { untrack, type Snippet } from "svelte";
  import { errorMessage } from "../../../ipc-error";
  import { codeburn, onCodeburn, peekCodeburn } from "../../../stores/codeburn";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";

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

  // A cached result shows at once; the previous one stays on screen while the next loads.
  $effect(() => {
    const argv = args;
    const fresh = refresh !== seenRefresh || retries !== seenRetries;
    seenRefresh = refresh;
    seenRetries = retries;
    let live = true;
    const cached = peekCodeburn<T>(argv);
    if (cached !== undefined && !fresh) data = cached;
    loading = cached === undefined || fresh;
    error = null;
    // Background refreshes land here too.
    const stop = onCodeburn<T>(argv, (value) => {
      if (live) data = value;
    });
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
      stop();
    };
  });
</script>

{#if error}
  <Alert.Root variant="destructive">
<Icon name="error" />
<Alert.Title>Couldn't read codeburn stats</Alert.Title>
<Alert.Description>{error}</Alert.Description>
<Alert.Action><Button variant="outline" size="sm" onclick={() => retries++}>Retry</Button></Alert.Action>
</Alert.Root>
{:else if data === null}
  <Skeleton style="height: var(--sp-10)" class="rounded-sm" />
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
