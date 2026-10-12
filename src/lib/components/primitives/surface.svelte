<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const toneClasses = {
		panel: 'surface-panel',
		subtle: 'surface-subtle',
		strong: 'surface-strong',
		brand: 'surface-brand'
	} as const;

	let {
		as: element = 'div',
		tone = 'panel',
		padded = false,
		class: className,
		children,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		tone?: keyof typeof toneClasses;
		padded?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="surface"
	class={cn(toneClasses[tone], 'ui-radius-md border', padded && 'p-3', className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
