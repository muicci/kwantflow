<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		as: element = 'div',
		gap = 'var(--space-2)',
		align = 'center',
		justify = 'flex-start',
		wrap = false,
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		gap?: string;
		align?: string;
		justify?: string;
		wrap?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="inline"
	class={cn('ui-inline', className)}
	style:gap
	style:align-items={align}
	style:justify-content={justify}
	style:flex-wrap={wrap ? 'wrap' : 'nowrap'}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
