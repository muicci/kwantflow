<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		as: element = 'div',
		gap = 'var(--space-2)',
		align = 'center',
		justify = 'flex-start',
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		gap?: string;
		align?: string;
		justify?: string;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="cluster"
	class={cn('ui-cluster', className)}
	style:gap
	style:align-items={align}
	style:justify-content={justify}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
