<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLParagraphElement>, HTMLParagraphElement> = $props();
</script>

<p
	bind:this={ref}
	data-slot="empty-description"
	class={cn('muted max-w-sm text-balance', className)}
	{...restProps}
>
	{@render children?.()}
</p>
