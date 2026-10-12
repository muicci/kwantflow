<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const toneClasses = {
		panel: 'surface-panel',
		subtle: 'surface-subtle',
		strong: 'surface-strong',
		brand: 'surface-brand'
	} as const;

	const insetClasses = {
		sm: 'p-3',
		md: 'p-4'
	} as const;

	let {
		as: element = 'section',
		tone = 'panel',
		inset = 'sm',
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		tone?: keyof typeof toneClasses;
		inset?: keyof typeof insetClasses;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="panel"
	class={cn('ui-panel ui-radius-md border', toneClasses[tone], insetClasses[inset], className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
