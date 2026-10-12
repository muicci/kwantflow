<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const toneClasses = {
		body: 'field-copy',
		muted: 'muted',
		meta: 'caption',
		table: 'table-copy'
	} as const;

	let {
		as: element = 'p',
		tone = 'body',
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
	data-kf-primitive="text"
	class={cn(toneClasses[tone], className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
