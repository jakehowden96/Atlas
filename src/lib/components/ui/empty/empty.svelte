<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		/** compact: one line, for tree sections and rail tiles. */
		size?: "default" | "compact";
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty"
	data-size={size}
	class={cn(
		"group/empty flex w-full min-w-0 flex-col items-center justify-center gap-1.5 p-6 text-center data-[size=compact]:flex-row data-[size=compact]:justify-start data-[size=compact]:gap-1.5 data-[size=compact]:px-1.5 data-[size=compact]:py-1 data-[size=compact]:text-left data-[size=compact]:text-caption data-[size=compact]:text-muted-foreground",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
