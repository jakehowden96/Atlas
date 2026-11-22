<script lang="ts" module>
  import { tv, type VariantProps } from "$lib/utils.js";

  // Grid: icon · title/description · actions. warning/destructive carry a matching 1px ring.
  export const alertVariants = tv({
    base: "group/alert relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm text-foreground has-[>[data-slot=icon]]:grid-cols-[18px_minmax(0,1fr)_auto] *:data-[slot=icon]:row-span-2 *:data-[slot=icon]:text-[18px]! *:data-[slot=icon]:text-muted-foreground",
    variants: {
      variant: {
        default: "",
        destructive: "border-destructive *:data-[slot=icon]:text-destructive",
        warning: "border-warning *:data-[slot=icon]:text-warning",
        success: "*:data-[slot=icon]:text-success",
      },
      layout: {
        default: "",
        inline: "items-center px-2.5 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
      layout: "default",
    },
  });

  export type AlertVariant = VariantProps<typeof alertVariants>["variant"];
  export type AlertLayout = VariantProps<typeof alertVariants>["layout"];
</script>

<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    variant = "default",
    layout = "default",
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    variant?: AlertVariant;
    layout?: AlertLayout;
  } = $props();
</script>

<div
  bind:this={ref}
  data-slot="alert"
  data-variant={variant}
  role={variant === "destructive" ? "alert" : "status"}
  class={cn(alertVariants({ variant, layout }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
