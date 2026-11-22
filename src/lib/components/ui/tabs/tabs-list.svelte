<script lang="ts" module>
  import { tv, type VariantProps } from "$lib/utils.js";

  // default = segmented well; line = document tabs (36px, 2px primary underline);
  // orientation="vertical" on Tabs.Root = Settings nav (32px rows, active accent + semibold).
  export const tabsListVariants = tv({
    base: "group/tabs-list inline-flex w-fit items-center text-caption font-medium group-data-[orientation=vertical]/tabs:h-auto group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:items-stretch group-data-[orientation=vertical]/tabs:gap-px group-data-[orientation=vertical]/tabs:text-sm group-data-[orientation=vertical]/tabs:font-normal",
    variants: {
      variant: {
        default:
          "group-data-[orientation=horizontal]/tabs:gap-px group-data-[orientation=horizontal]/tabs:rounded-md group-data-[orientation=horizontal]/tabs:bg-muted group-data-[orientation=horizontal]/tabs:p-0.5",
        line: "h-9 items-stretch gap-0 rounded-none border-b border-border bg-transparent p-0 text-sm font-normal",
      },
      size: {
        default: "",
        lg: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type TabsListVariant = VariantProps<typeof tabsListVariants>["variant"];
  export type TabsListSize = VariantProps<typeof tabsListVariants>["size"];
</script>

<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    variant = "default",
    size = "default",
    class: className,
    ...restProps
  }: TabsPrimitive.ListProps & {
    variant?: TabsListVariant;
    size?: TabsListSize;
  } = $props();
</script>

<TabsPrimitive.List
  bind:ref
  data-slot="tabs-list"
  data-variant={variant}
  data-size={size}
  class={cn(tabsListVariants({ variant, size }), className)}
  {...restProps}
/>
