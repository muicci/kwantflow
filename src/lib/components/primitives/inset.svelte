<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const insetClasses = {
		xs: 'p-2',
		sm: 'p-3',
		md: 'p-4'
	} as const;

	let {
		as: element = 'div',
		inset = 'sm',
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		inset?: keyof typeof insetClasses;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="inset"
	class={cn('ui-inset', insetClasses[inset], className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
