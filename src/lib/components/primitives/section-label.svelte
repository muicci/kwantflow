<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		as: element = 'span',
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="section-label"
	class={cn('field-label inline-flex items-center leading-none', className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
