<script lang="ts" module>
  import { tv, type VariantProps } from "$lib/utils.js";

  export const buttonGroupVariants = tv({
    base: "group/button-group flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 *:focus-visible:relative *:focus-visible:z-10 [&>input]:flex-1",
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:-mt-px [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  });

  export type ButtonGroupOrientation = VariantProps<typeof buttonGroupVariants>["orientation"];
</script>

<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    orientation = "horizontal",
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    orientation?: ButtonGroupOrientation;
  } = $props();
</script>

<div
  bind:this={ref}
  role="group"
  data-slot="button-group"
  data-orientation={orientation}
  class={cn(buttonGroupVariants({ orientation }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
