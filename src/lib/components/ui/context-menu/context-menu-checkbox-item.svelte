<script lang="ts">
	import Icon from "$lib/components/ui/icon/icon.svelte";
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		inset,
		children: childrenProp,
		closeOnSelect = false,
		...restProps
	}: WithoutChildrenOrChild<ContextMenuPrimitive.CheckboxItemProps> & {
		inset?: boolean;
		children?: Snippet;
	} = $props();
</script>

<ContextMenuPrimitive.CheckboxItem
	bind:ref
	{closeOnSelect}
	bind:checked
	bind:indeterminate
	data-slot="context-menu-checkbox-item"
	data-inset={inset}
	class={cn(
		"group/menu-item relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground *:data-[slot=icon]:text-muted-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:*:data-[slot=icon]:text-destructive data-disabled:pointer-events-none data-disabled:text-muted-foreground data-inset:pl-[34px] pr-8",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		<span class="absolute right-2 pointer-events-none">
			{#if checked}
				<Icon name="check" size={16} />
			{/if}
		</span>
		{@render childrenProp?.()}
	{/snippet}
</ContextMenuPrimitive.CheckboxItem>
