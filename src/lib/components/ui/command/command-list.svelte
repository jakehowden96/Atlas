<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CommandPrimitive.ListProps = $props();
</script>

<CommandPrimitive.List
	bind:ref
	data-slot="command-list"
	class={cn("max-h-[min(420px,60vh)] scroll-py-1.5 overflow-x-hidden overflow-y-auto py-1.5 outline-none", className)}
	{...restProps}
/>
