<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	interface Props {
		forceMount?: boolean;
		hiddenUntilFound?: boolean;
		ref?: HTMLElement | null;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	}
	let { ref = $bindable(null), class: className, children, ...restProps }: Props = $props();
</script>

<AccordionPrimitive.Content bind:ref class={cn('ui-accordion-content', className)} {...restProps}>
	{@render children?.()}
</AccordionPrimitive.Content>
