<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		as: element = 'div',
		class: className,
		children,
		invalidTone,
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		class?: string;
		children?: Snippet;
		invalidTone?: 'neutral' | 'destructive';
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="field-shell"
	data-invalid-tone={invalidTone}
	class={cn('ui-field-shell', className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
