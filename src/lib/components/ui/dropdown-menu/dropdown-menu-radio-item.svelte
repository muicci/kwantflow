<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children: childrenProp,
		...restProps
	}: WithoutChild<DropdownMenuPrimitive.RadioItemProps> = $props();
</script>

<DropdownMenuPrimitive.RadioItem
	bind:ref
	data-slot="dropdown-menu-radio-item"
	class={cn(
		"menu-copy ui-floating-field-item ui-floating-field-item-end-indicator [&_svg:not([class*='text-'])]:muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		{@render childrenProp?.({ checked })}
		<span class="ui-selector-item-check">
			{#if checked}
				<CheckIcon class="size-4" />
			{/if}
		</span>
	{/snippet}
</DropdownMenuPrimitive.RadioItem>
