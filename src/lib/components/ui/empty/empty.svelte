<!-- Generic centred empty state primitive used by first-class table pages. -->
<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-root"
	class={cn(
		'flex h-full w-full flex-col items-center justify-center gap-5 px-4 py-10 text-center',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
