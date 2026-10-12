<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	const toneClasses = {
		default: 'field-help',
		destructive: 'field-help status-text-destructive'
	} as const;

	let {
		as: element = 'p',
		class: className,
		children,
		tone = 'default',
		...restProps
	}: {
		as?: keyof HTMLElementTagNameMap;
		class?: string;
		children?: Snippet;
		tone?: keyof typeof toneClasses;
	} = $props();
</script>

<svelte:element
	this={element}
	data-kf-primitive="field-help"
	class={cn(toneClasses[tone], 'px-1', className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
