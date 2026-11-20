<script lang="ts">
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { cn } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		...props
	}: ComponentProps<typeof Textarea> = $props();
</script>

<Textarea
	bind:ref
	data-slot="input-group-control"
	class={cn("flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-[7px] shadow-none focus-visible:outline-none disabled:bg-transparent", className)}
	bind:value
	{...props}
/>
