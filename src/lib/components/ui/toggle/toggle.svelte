<script lang="ts" module>
	import { tv, type VariantProps } from "$lib/utils.js";

	export const toggleVariants = tv({
		base: "group/toggle inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium text-muted-foreground transition-colors duration-(--dur-instant) hover:bg-muted hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground disabled:cursor-default disabled:text-muted-foreground",
		variants: {
			variant: {
				default: "bg-transparent",
				outline: "border border-input bg-card hover:bg-muted",
			},
			size: {
				default: "h-7 min-w-7 px-2.5",
				sm: "h-6 min-w-6 px-2 text-caption",
				lg: "h-8 min-w-8 px-3",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ToggleVariant = VariantProps<typeof toggleVariants>["variant"];
	export type ToggleSize = VariantProps<typeof toggleVariants>["size"];
	export type ToggleVariants = VariantProps<typeof toggleVariants>;
</script>

<script lang="ts">
	import { Toggle as TogglePrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		pressed = $bindable(false),
		class: className,
		size = "default",
		variant = "default",
		...restProps
	}: TogglePrimitive.RootProps & {
		variant?: ToggleVariant;
		size?: ToggleSize;
	} = $props();
</script>

<TogglePrimitive.Root
	bind:ref
	bind:pressed
	data-slot="toggle"
	class={cn(toggleVariants({ variant, size }), className)}
	{...restProps}
/>
