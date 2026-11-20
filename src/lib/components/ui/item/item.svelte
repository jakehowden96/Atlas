<script lang="ts" module>
	import { tv, type VariantProps } from "$lib/utils.js";

	export const itemVariants = tv({
		base: "group/item flex w-full min-w-0 items-center gap-2 rounded-md text-sm text-foreground transition-colors duration-(--dur-instant) focus-visible:outline-offset-[-2px] [a]:cursor-pointer [button]:cursor-pointer data-[selected=true]:bg-accent data-[selected=true]:font-semibold aria-selected:bg-accent aria-selected:font-semibold data-[disabled=true]:text-muted-foreground",
		variants: {
			variant: {
				default: "hover:bg-muted",
				outline: "border border-border",
				muted: "bg-muted",
			},
			size: {
				default: "min-h-8 px-2",
				lg: "min-h-9 px-2",
				sm: "min-h-7 px-2 text-caption",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ItemSize = VariantProps<typeof itemVariants>["size"];
	export type ItemVariant = VariantProps<typeof itemVariants>["variant"];
	// outline rows (settings, connectors) are taller and padded.
	export const itemOutlineClass = "px-3 py-2.5";
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		child,
		variant = "default",
		size = "default",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		variant?: ItemVariant;
		size?: ItemSize;
	} = $props();

	const mergedProps = $derived({
		class: cn(itemVariants({ variant, size }), variant === "outline" && itemOutlineClass, className),
		"data-slot": "item",
		"data-variant": variant,
		"data-size": size,
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<div bind:this={ref} {...mergedProps}>
		{@render mergedProps.children?.()}
	</div>
{/if}
