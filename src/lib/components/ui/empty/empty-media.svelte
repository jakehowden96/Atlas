<script lang="ts" module>
	import { tv, type VariantProps } from "$lib/utils.js";

	export const emptyMediaVariants = tv({
		base: "flex shrink-0 items-center justify-center group-data-[size=compact]/empty:mb-0",
		variants: {
			variant: {
				default: "bg-transparent",
				icon: "mb-1 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground group-data-[size=compact]/empty:size-auto group-data-[size=compact]/empty:bg-transparent",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type EmptyMediaVariant = VariantProps<typeof emptyMediaVariants>["variant"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		variant = "default",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { variant?: EmptyMediaVariant } = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-icon"
	data-variant={variant}
	class={cn(emptyMediaVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
