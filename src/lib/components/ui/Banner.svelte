<script module lang="ts">
  export type BannerTone = "info" | "success" | "warn" | "error";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  interface Props {
    tone?: BannerTone;
    title: string;
    children?: Snippet;
    /** Buttons rendered on the right. */
    actions?: Snippet;
    ondismiss?: () => void;
  }

  let { tone = "info", title, children, actions, ondismiss }: Props = $props();

  const ICON: Record<BannerTone, IconName> = {
    info: "info",
    success: "check_circle",
    warn: "warning",
    error: "error",
  };
</script>

<div class="banner {tone}" role={tone === "error" ? "alert" : "status"}>
  <span class="mark"><Icon name={ICON[tone]} size={18} /></span>
  <div class="text">
    <div class="title">{title}</div>
    {#if children}<div class="body">{@render children()}</div>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
  {#if ondismiss}
    <button type="button" class="close" aria-label="Dismiss" onclick={ondismiss}>
      <Icon name="close" />
    </button>
  {/if}
</div>

<style>
  .banner {
    --tone: var(--accent);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border2);
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--tone) 10%, var(--surface));
    font-family: var(--font-ui);
  }
  .success {
    --tone: var(--accent);
  }
  .warn {
    --tone: var(--warn);
    border-color: var(--tone);
  }
  .error {
    --tone: var(--danger);
    border-color: var(--tone);
  }
  .mark {
    display: flex;
    color: var(--tone);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
  }
  .body {
    margin-top: 2px;
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--text);
  }
</style>
