<script lang="ts">
	import Icon from "$lib/components/ui/icon/icon.svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLSelectAttributes } from "svelte/elements";

	type NativeSelectProps = Omit<WithElementRef<HTMLSelectAttributes, HTMLSelectElement>, "size"> & {
		size?: "sm" | "default";
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = "default",
		children,
		...restProps
	}: NativeSelectProps = $props();
</script>

<div
	class={cn(
		"group/native-select relative w-full",
		className
	)}
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:value
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class="h-7 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-card text-sm text-foreground transition-colors duration-(--dur-instant) pr-7 pl-2.5 focus-visible:border-foreground focus-visible:outline-offset-1 aria-invalid:border-destructive data-[size=sm]:h-6 data-[size=sm]:text-caption disabled:cursor-default disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
		{...restProps}
	>
		{@render children?.()}
	</select>
	<Icon name="expand_more" size={16} class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground" />
</div>
