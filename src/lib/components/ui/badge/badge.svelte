<script lang="ts" module>
  import { tv, type VariantProps } from "$lib/utils.js";

  // Pill, 20px. success/warning/destructive are outlined (currentColor ring + text), never filled.
  // `secondary` is the count badge.
  export const badgeVariants = tv({
    base: "inline-flex w-fit shrink-0 items-center justify-center gap-[5px] overflow-hidden whitespace-nowrap rounded-full border border-transparent px-2 text-xs leading-none font-semibold [&_[data-slot=icon]]:text-[14px]!",
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-accent text-foreground",
        outline: "border-input bg-transparent text-foreground",
        destructive: "border-current bg-transparent text-destructive",
        success: "border-current bg-transparent text-success",
        warning: "border-current bg-transparent text-warning",
        muted: "border-input bg-transparent text-muted-foreground",
      },
      size: {
        default: "h-5",
        sm: "h-[18px] min-w-[18px] px-[5px] font-mono font-medium",
        lg: "h-[22px] px-[9px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
  export type BadgeSize = VariantProps<typeof badgeVariants>["size"];
</script>

<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAnchorAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = "default",
    size = "default",
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    variant?: BadgeVariant;
    size?: BadgeSize;
  } = $props();
</script>

<svelte:element
  this={href ? "a" : "span"}
  bind:this={ref}
  data-slot="badge"
  data-variant={variant}
  {href}
  class={cn(badgeVariants({ variant, size }), className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
