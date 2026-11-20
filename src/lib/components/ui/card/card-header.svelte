<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-header"
	class={cn(
		"group/card-header grid auto-rows-min items-center gap-x-2 gap-y-0.5 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
