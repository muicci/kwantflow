<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const insetClasses = {
		none: '',
		xs: 'p-2',
		sm: 'p-3',
		md: 'p-4',
		lg: 'p-5'
	} as const;

	let {
		as: element = 'div',
		inset = 'none',
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
	data-kf-primitive="box"
	class={cn('ui-box', insetClasses[inset], className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
