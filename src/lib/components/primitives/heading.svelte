<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const toneClasses = {
		page: 'h3',
		section: 'h4',
		panel: 'title-copy'
	} as const;

	let {
		as: element = 'h2',
		tone = 'section',
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		tone?: keyof typeof toneClasses;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="heading"
	class={cn(toneClasses[tone], className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
