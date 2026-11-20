<script lang="ts">
  import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
  import Icon from "../icon/icon.svelte";
  import { themeMode } from "$lib/theme";
  import { MAX_VISIBLE_TOASTS } from "$lib/stores/toast";

  let { ...restProps }: SonnerProps = $props();
</script>

<!-- shadcn's Sonner, themed from Atlas tokens: bottom-right, 340px, tone on the icon only. -->
<Sonner
  theme={$themeMode}
  position="bottom-right"
  visibleToasts={MAX_VISIBLE_TOASTS}
  closeButton
  class="toaster group"
  style="--normal-bg: var(--popover); --normal-text: var(--popover-foreground); --normal-border: var(--input); --border-radius: var(--radius-xl); --width: 340px; z-index: var(--z-toast); --toast-close-button-start: unset; --toast-close-button-end: 0; --toast-close-button-transform: translate(35%, -35%);"
  toastOptions={{
    classes: {
      toast: "group/toast !font-sans !shadow-elev-2",
      title: "!text-sm !font-semibold !leading-5",
      description: "!text-caption !text-muted-foreground",
      icon: "group-data-[type=success]/toast:text-success group-data-[type=warning]/toast:text-warning group-data-[type=error]/toast:text-destructive group-data-[type=info]/toast:text-muted-foreground",
      actionButton:
        "!h-6 !rounded-md !border !border-input !bg-card !px-2 !text-caption !font-medium !text-foreground hover:!bg-muted",
      closeButton: "!border-input !bg-popover !text-muted-foreground hover:!text-foreground",
    },
  }}
  {...restProps}
>
  {#snippet successIcon()}<Icon name="check_circle" size={18} />{/snippet}
  {#snippet infoIcon()}<Icon name="info" size={18} />{/snippet}
  {#snippet warningIcon()}<Icon name="warning" size={18} />{/snippet}
  {#snippet errorIcon()}<Icon name="error" size={18} />{/snippet}
  {#snippet loadingIcon()}<Icon name="progress_activity" size={18} class="animate-spin-atlas" />{/snippet}
</Sonner>
