<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLThAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLThAttributes> = $props();
</script>

<th bind:this={ref} data-slot="table-head" class={cn("h-8 bg-muted px-3 text-left align-middle font-semibold whitespace-nowrap text-foreground", className)} {...restProps}>
	{@render children?.()}
</th>
