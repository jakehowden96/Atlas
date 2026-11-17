<script module lang="ts">
  /** Glyphs in the subset font. Keep in step with src/assets/fonts/icon-names.txt (checked by icon.test.ts). */
  export const ICONS = [
    "close",
    "settings",
    "keep",
    "terminal",
    "chevron_right",
    "expand_more",
    "arrow_back",
    "open_in_new",
    "search",
    "add",
    "remove",
    "content_copy",
    "check",
    "error",
    "warning",
    "info",
    "check_circle",
    "refresh",
    "link",
    "link_off",
    "more_horiz",
    "right_panel_close",
    "right_panel_open",
    "difference",
    "folder",
    "description",
    "article",
    "data_object",
    "code",
    "fork_right",
    "notifications",
    "keyboard",
    "delete",
    "edit",
    "progress_activity",
    "key",
    "arrow_upward",
    "confirmation_number",
  ] as const;
  export type IconName = (typeof ICONS)[number];
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    /** 16 inline with text; 20 in sm/md buttons (the font's design size); 24 in lg. */
    size?: 16 | 20 | 24;
    /** Announced name; without it the icon is hidden from assistive tech. */
    label?: string;
  }

  let { name, size = 16, label }: Props = $props();

  // Glyphs that draw less ink than their neighbours get whole extra pixels; opsz follows.
  const OPTICAL: Partial<Record<IconName, number>> = { close: 2 };

  let px = $derived(size + (OPTICAL[name] ?? 0));
  // opsz bottoms out at 20, so smaller sizes are scaled copies: heavier wght keeps their strokes from thinning.
  let variation = $derived(
    `"FILL" 0, "wght" ${px < 20 ? 500 : 400}, "GRAD" 0, "opsz" ${Math.min(48, Math.max(20, px))}`,
  );
</script>

<span
  class="material-symbols-outlined"
  style:font-size="{px}px"
  style:font-variation-settings={variation}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}>{name}</span
>
