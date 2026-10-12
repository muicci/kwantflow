<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props {
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		ref?: HTMLElement | null;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	}
	let { ref = $bindable(null), class: className, children, ...restProps }: Props = $props();
</script>

<AccordionPrimitive.Header bind:ref class={cn('ui-accordion-header-row', className)} {...restProps}>
	{@render children?.()}
</AccordionPrimitive.Header>
