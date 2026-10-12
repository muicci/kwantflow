<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props {
		ref?: HTMLElement | null;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	}
	let { ref = $bindable(null), class: className, children, ...restProps }: Props = $props();
</script>

<AccordionPrimitive.Trigger bind:ref class={cn('ui-accordion-trigger', className)} {...restProps}>
	{@render children?.()}
</AccordionPrimitive.Trigger>
