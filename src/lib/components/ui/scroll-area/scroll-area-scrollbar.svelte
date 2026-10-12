<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		orientation = 'vertical',
		children,
		...restProps
	}: WithoutChild<ScrollAreaPrimitive.ScrollbarProps> = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
	bind:ref
	data-slot="scroll-area-scrollbar"
	{orientation}
	class={cn(
		'ui-scrollbar-track',
		orientation === 'vertical' && 'ui-scrollbar-track-vertical border-s border-s-transparent',
		orientation === 'horizontal' && 'ui-scrollbar-track-horizontal border-t border-t-transparent',
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" class="ui-scrollbar-thumb" />
</ScrollAreaPrimitive.Scrollbar>
