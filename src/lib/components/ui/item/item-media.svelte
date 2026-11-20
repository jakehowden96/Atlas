<script lang="ts" module>
	import { tv, type VariantProps } from "$lib/utils.js";

	export const itemMediaVariants = tv({
		base: "flex min-w-4 shrink-0 items-center justify-center text-muted-foreground group-has-data-[slot=item-description]/item:self-start group-has-data-[slot=item-description]/item:pt-0.5",
		variants: {
			variant: {
				default: "bg-transparent",
				icon: "",
				image: "size-10 overflow-hidden rounded-sm group-data-[size=sm]/item:size-8 group-data-[size=xs]/item:size-6 [&_img]:size-full [&_img]:object-cover",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type ItemMediaVariant = VariantProps<typeof itemMediaVariants>["variant"];
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
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { variant?: ItemMediaVariant } = $props();
</script>

<div
	bind:this={ref}
	data-slot="item-media"
	data-variant={variant}
	class={cn(itemMediaVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
