<script lang="ts">
  import type { ComponentProps } from "svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button, type ButtonVariant } from "$lib/components/ui/button/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import Icon, { type IconName } from "$lib/components/ui/icon/icon.svelte";

  /** An icon-only shadcn Button whose label is its tooltip and its accessible name. */
  let {
    icon,
    label,
    variant = "ghost",
    size = "md",
    shortcut,
    side = "top",
    align = "center",
    ...rest
  }: Omit<ComponentProps<typeof Button>, "size" | "variant" | "children"> & {
    icon: IconName;
    label: string;
    variant?: ButtonVariant;
    size?: "sm" | "md" | "lg";
    shortcut?: string;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  } = $props();

  const sizes = { sm: "icon-sm", md: "icon", lg: "icon-lg" } as const;
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button {...props} {...rest} {variant} size={sizes[size]} aria-label={label}>
        <Icon name={icon} size={size === "lg" ? 24 : 20} />
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side} {align}>
    {label}{#if shortcut}<Kbd>{shortcut}</Kbd>{/if}
  </Tooltip.Content>
</Tooltip.Root>
