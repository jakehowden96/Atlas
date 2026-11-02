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
  ] as const;
  export type IconName = (typeof ICONS)[number];
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: 16 | 18;
    /** Announced name; without it the icon is hidden from assistive tech. */
    label?: string;
  }

  let { name, size = 16, label }: Props = $props();
</script>

<span
  class="material-symbols-outlined"
  style:font-size="{size}px"
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}>{name}</span
>
