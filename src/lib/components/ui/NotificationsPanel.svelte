<script module lang="ts">
  import { derived } from "svelte/store";
  import { notificationLog } from "../../stores/toast";

  /** For the bell badge. */
  export const unreadNotificationCount = derived(
    notificationLog,
    ($l) => $l.filter((e) => !e.read).length,
  );

  export function relativeTime(then: number, now: number): string {
    const s = Math.max(0, Math.round((now - then) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
</script>

<script lang="ts">
  import { clearLog, markAllRead, type NotificationEntry } from "../../stores/toast";
  import Button from "./Button.svelte";
  import EmptyState from "./EmptyState.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  const ICON: Record<NotificationEntry["type"], IconName> = {
    info: "info",
    success: "check_circle",
    warning: "warning",
    error: "error",
  };

  let expanded = $state(new Set<string>());
  let now = $state(Date.now());

  const items = $derived([...$notificationLog].reverse());

  // Showing the panel is what reads the items, after a beat so the dots are seen.
  $effect(() => {
    const t = setTimeout(markAllRead, 1000);
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  });

  function toggle(id: string) {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    expanded = next;
  }

  function copy(e: NotificationEntry) {
    void navigator.clipboard?.writeText(e.body ? `${e.title}\n${e.body}` : e.title);
  }
</script>

<section class="panel" aria-label="Notifications">
  <header>
    <h2>Notifications</h2>
    <Button size="sm" variant="ghost" onclick={markAllRead}>Mark all read</Button>
    <Button size="sm" variant="ghost" onclick={clearLog}>Clear all, cannot be undone</Button>
  </header>
  {#if items.length === 0}
    <EmptyState compact icon="notifications" title="No notifications" />
  {:else}
    <ul role="list">
      {#each items as e (e.id)}
        <li class="row {e.type}">
          <span class="tone"><Icon name={ICON[e.type]} size={16} /></span>
          <div class="text">
            <div class="title">
              {#if !e.read}<span class="dot" role="img" aria-label="Unread"></span>{/if}
              <span class="sr">{e.type}: </span>{e.title}
              <time>{relativeTime(e.time, now)}</time>
            </div>
            {#if e.body}
              <p class="body" class:clamp={!expanded.has(e.id)}>{e.body}</p>
              <button
                type="button"
                class="more"
                aria-expanded={expanded.has(e.id)}
                onclick={() => toggle(e.id)}
              >
                {expanded.has(e.id) ? "Show less" : "Show more"}
              </button>
            {/if}
          </div>
          <IconButton icon="content_copy" size="sm" label="Copy" onclick={() => copy(e)} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    width: 22rem;
    max-height: 28rem;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    color: var(--text);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-3);
    border-bottom: 1px solid var(--border2);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }
  .row {
    display: flex;
    gap: var(--sp-3);
    align-items: flex-start;
    padding: var(--sp-3);
    border-bottom: 1px solid var(--border2);
  }
  .tone {
    display: inline-flex;
    margin-top: 2px;
    color: var(--accent);
  }
  .error .tone {
    color: var(--danger);
  }
  .warning .tone {
    color: var(--warn);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  time {
    margin-left: auto;
    font-size: var(--fs-xs);
    font-weight: normal;
    color: var(--muted);
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .body {
    margin: var(--sp-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .more {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
</style>
