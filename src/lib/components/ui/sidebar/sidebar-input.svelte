<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(''),
		class: className,
		...restProps
	}: ComponentProps<typeof SearchInput> = $props();
</script>

<SearchInput
	bind:ref
	bind:value
	data-slot="sidebar-input"
	data-sidebar="input"
	class={cn('w-full', className)}
	inputClass="control-height-md"
	{...restProps}
/>
