<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props {
		value: string;
		disabled?: boolean;
		ref?: HTMLElement | null;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	}
	let { ref = $bindable(null), class: className, children, ...restProps }: Props = $props();
</script>

<AccordionPrimitive.Item
	bind:ref
	class={cn('ui-accordion-item min-h-0 overflow-hidden', className)}
	{...restProps}
>
	{@render children?.()}
</AccordionPrimitive.Item>
