<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let { ref = $bindable(null), class: className, ...restProps }: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
  bind:ref
  data-slot="tabs-trigger"
  class={cn(
    "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-muted-foreground transition-colors duration-(--dur-instant) hover:text-foreground disabled:cursor-default disabled:text-muted-foreground",
    // default: segmented well
    "group-data-[variant=default]/tabs-list:group-data-[orientation=horizontal]/tabs:h-[22px] group-data-[variant=default]/tabs-list:group-data-[orientation=horizontal]/tabs:rounded-sm group-data-[variant=default]/tabs-list:group-data-[orientation=horizontal]/tabs:px-2.5",
    "group-data-[variant=default]/tabs-list:group-data-[orientation=horizontal]/tabs:data-[state=active]:bg-card group-data-[variant=default]/tabs-list:group-data-[orientation=horizontal]/tabs:data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:group-data-[orientation=horizontal]/tabs:data-[state=active]:shadow-[inset_0_0_0_1px_var(--input)]",
    "group-data-[size=lg]/tabs-list:h-6 group-data-[size=lg]/tabs-list:text-sm",
    // line: document tabs
    "group-data-[variant=line]/tabs-list:pr-1.5 group-data-[variant=line]/tabs-list:pl-3 group-data-[variant=line]/tabs-list:focus-visible:outline-offset-[-2px]",
    "group-data-[variant=line]/tabs-list:data-[state=active]:font-medium group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground group-data-[variant=line]/tabs-list:data-[state=active]:shadow-[inset_0_-2px_0_var(--primary)]",
    // vertical: settings nav
    "group-data-[orientation=vertical]/tabs:h-8 group-data-[orientation=vertical]/tabs:justify-start group-data-[orientation=vertical]/tabs:rounded-md group-data-[orientation=vertical]/tabs:px-2.5 group-data-[orientation=vertical]/tabs:text-foreground group-data-[orientation=vertical]/tabs:hover:bg-muted",
    "group-data-[orientation=vertical]/tabs:data-[state=active]:bg-accent group-data-[orientation=vertical]/tabs:data-[state=active]:font-semibold",
    className,
  )}
  {...restProps}
/>
