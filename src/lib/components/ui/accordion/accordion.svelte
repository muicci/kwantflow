<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props {
		type?: 'single' | 'multiple';
		value?: string | string[];
		disabled?: boolean;
		ref?: HTMLElement | null;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	}
	let {
		ref = $bindable(null),
		type = 'single',
		value = $bindable<string | string[] | undefined>(),
		class: className,
		children,
		...restProps
	}: Props = $props();
</script>

<AccordionPrimitive.Root
	bind:ref
	{type}
	bind:value={value as never}
	class={cn('ui-accordion-root min-h-0', className)}
	{...restProps}
>
	{@render children?.()}
</AccordionPrimitive.Root>
