<script lang="ts">
  import { Switch as SwitchPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    checked = $bindable(false),
    ...restProps
  }: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props();
</script>

<!-- 32×18. On: success track, success-foreground thumb. Off: accent track with an input inset, muted thumb. -->
<SwitchPrimitive.Root
  bind:ref
  bind:checked
  data-slot="switch"
  class={cn(
    "peer group/switch relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full",
    "data-[state=unchecked]:bg-accent data-[state=unchecked]:shadow-[inset_0_0_0_1px_var(--input)] data-[state=checked]:bg-success",
    "data-disabled:cursor-default data-disabled:bg-muted data-disabled:shadow-[inset_0_0_0_1px_var(--border)]",
    className,
  )}
  {...restProps}
>
  <SwitchPrimitive.Thumb
    data-slot="switch-thumb"
    class="pointer-events-none block size-3 translate-x-[3px] rounded-full bg-muted-foreground transition-transform duration-(--dur-fast) ease-(--ease-out) data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-success-foreground group-data-disabled/switch:bg-border"
  />
</SwitchPrimitive.Root>
