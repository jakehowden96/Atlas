<script lang="ts" module>
  import { cn, tv, type VariantProps, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

  // Atlas density: xs 20 · sm 24 · default 28 · lg 32. Disabled never uses opacity.
  export const buttonVariants = tv({
    base: "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-sans text-sm leading-none font-medium no-underline transition-colors duration-(--dur-instant) select-none [&_[data-slot=icon]]:pointer-events-none disabled:cursor-default disabled:border-border disabled:bg-muted disabled:text-muted-foreground aria-disabled:cursor-default aria-disabled:border-border aria-disabled:bg-muted aria-disabled:text-muted-foreground",
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-(--primary-hover)",
        outline: "border-input bg-card text-foreground hover:bg-muted aria-expanded:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "h-auto! bg-transparent p-0! text-foreground underline decoration-input underline-offset-3 hover:decoration-foreground",
      },
      size: {
        default: "h-7 px-3",
        xs: "h-5 gap-1 rounded-sm px-1.5 text-xs",
        sm: "h-6 gap-1 px-2 text-caption",
        lg: "h-8 px-3.5",
        icon: "size-7",
        "icon-xs": "size-5 rounded-sm",
        "icon-sm": "size-6",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

  /** Icon size that matches each button size. */
  export const buttonIconSize: Record<NonNullable<ButtonSize>, number> = {
    default: 18,
    lg: 18,
    icon: 18,
    "icon-lg": 18,
    sm: 16,
    xs: 16,
    "icon-sm": 16,
    "icon-xs": 16,
  };

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
      /** Swaps the leading icon for a Spinner (width kept) and sets aria-busy. */
      loading?: boolean;
    };
</script>

<script lang="ts">
  import Spinner from "../spinner/spinner.svelte";

  let {
    class: className,
    variant = "default",
    size = "default",
    ref = $bindable(null),
    href = undefined,
    type = "button",
    disabled,
    loading = false,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    data-variant={variant}
    data-size={size}
    class={cn(buttonVariants({ variant, size }), className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    role={disabled ? "link" : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    data-variant={variant}
    data-size={size}
    data-loading={loading || undefined}
    class={cn(
      buttonVariants({ variant, size }),
      loading && "[&>[data-spinner]+[data-slot=icon]]:hidden",
      className,
    )}
    {type}
    {disabled}
    aria-busy={loading || undefined}
    {...restProps}
  >
    {#if loading}<Spinner size={buttonIconSize[size ?? "default"]} class="text-current" />{/if}
    {@render children?.()}
  </button>
{/if}
