<script module lang="ts">
  import { derived, writable } from "svelte/store";
  import { needsReconnect, offlineSince } from "../../stores/connectors";
  import { updateState } from "../../updater";

  const dismissed = writable(new Set<string>());
  const activeReconnects = derived([needsReconnect, dismissed], ([$n, $d]) =>
    $n.filter((c) => !$d.has(c.info.id)),
  );
  /** Chips currently showing, for the bell badge when they fold into its menu. */
  export const statusChipCount = derived(
    [offlineSince, activeReconnects, updateState],
    ([$o, $r, $u]) => ($o !== null ? 1 : 0) + $r.length + ($u.kind === "available" ? 1 : 0),
  );
  // A connector that recovers and expires again gets its chip back.
  needsReconnect.subscribe(($n) => {
    const ids = new Set($n.map((c) => c.info.id));
    dismissed.update((d) =>
      [...d].some((id) => !ids.has(id)) ? new Set([...d].filter((id) => ids.has(id))) : d,
    );
  });
</script>

<script lang="ts">
  import Button from "../ui/Button.svelte";
  import ConnectorLogo from "../ui/ConnectorLogo.svelte";
  import Popover from "../ui/Popover.svelte";
  import StatusMark from "../ui/StatusMark.svelte";
  import { installUpdate } from "../../updater";
  import { connect } from "../../stores/connectors";
  import { prsLastUpdated } from "../../stores/prs";
  import { settingsOpen } from "../../stores/settings";

  const reconnects = $derived($activeReconnects);
  const update = $derived($updateState.kind === "available" ? $updateState : null);
  const offline = $derived($offlineSince !== null);

  const lastTime = $derived(
    $prsLastUpdated === null
      ? null
      : new Date($prsLastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  );

  let open = $state<string | null>(null);
  let triggers = $state<Record<string, HTMLElement | undefined>>({});
  let installing = $state(false);

  const toggle = (id: string) => (open = open === id ? null : id);

  function reconnect(id: string) {
    open = null;
    settingsOpen.set(true);
    void connect(id);
  }

  function dismiss(id: string) {
    open = null;
    dismissed.update((d) => new Set(d).add(id));
  }

  async function install() {
    installing = true;
    await installUpdate();
    installing = false;
  }
</script>

{#if offline}
  <span class="chip" role="status">
    <StatusMark state="attention" />
    Offline{lastTime ? ` · showing data from ${lastTime}` : ""}
  </span>
{/if}

{#each reconnects as c (c.info.id)}
  <button
    bind:this={triggers[c.info.id]}
    type="button"
    class="chip"
    aria-haspopup="dialog"
    aria-expanded={open === c.info.id}
    onclick={() => toggle(c.info.id)}
  >
    <ConnectorLogo connector={c.info.id} size={16} />
    {c.info.name} needs reconnecting
  </button>
  <Popover
    open={open === c.info.id}
    trigger={triggers[c.info.id]}
    align="end"
    label="{c.info.name} needs reconnecting"
  >
    <div class="pop">
      <Button size="sm" variant="primary" onclick={() => reconnect(c.info.id)}>Reconnect</Button>
      <Button size="sm" variant="ghost" onclick={() => dismiss(c.info.id)}>Dismiss for now</Button>
    </div>
  </Popover>
{/each}

{#if update}
  <button
    bind:this={triggers.update}
    type="button"
    class="chip"
    aria-haspopup="dialog"
    aria-expanded={open === "update"}
    onclick={() => toggle("update")}
  >
    Update ready
  </button>
  <Popover open={open === "update"} trigger={triggers.update} align="end" label="Update ready">
    <div class="pop">
      <strong>Version {update.version}</strong>
      {#if update.notes}<p class="notes">{update.notes}</p>{/if}
      <Button size="sm" variant="primary" loading={installing} onclick={install}>
        Install and restart
      </Button>
    </div>
  </Popover>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--h-md);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface2);
    color: var(--text);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  button.chip {
    cursor: pointer;
  }

  .pop {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    max-width: 320px;
  }

  .notes {
    margin: 0;
    white-space: pre-wrap;
    color: var(--muted);
  }
</style>
