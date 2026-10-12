<script lang="ts">
	import type { EmptyMediaVariant } from './types.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
		variant?: EmptyMediaVariant;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-media"
	class={cn(
		'flex items-center justify-center',
		variant === 'icon' && 'ui-empty-media-icon [&_svg]:size-4',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
