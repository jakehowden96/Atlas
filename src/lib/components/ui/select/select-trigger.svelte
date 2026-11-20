<script lang="ts">
	import Icon from "$lib/components/ui/icon/icon.svelte";
	import { Select as SelectPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		...restProps
	}: WithoutChild<SelectPrimitive.TriggerProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	data-size={size}
	class={cn(
		"flex h-7 w-full min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded-md border border-input bg-card pr-1.5 pl-2.5 text-sm whitespace-nowrap text-foreground transition-colors duration-(--dur-instant) select-none data-placeholder:text-muted-foreground focus-visible:border-foreground aria-invalid:border-destructive aria-expanded:border-foreground data-[size=sm]:h-6 data-[size=sm]:text-caption disabled:cursor-default disabled:border-border disabled:bg-muted disabled:text-muted-foreground *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 *:data-[slot=select-value]:truncate",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<Icon name="expand_more" size={16} />
</SelectPrimitive.Trigger>
