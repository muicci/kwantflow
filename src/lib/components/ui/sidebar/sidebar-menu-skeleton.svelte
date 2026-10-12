<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		showIcon = false,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		showIcon?: boolean;
	} = $props();

	// Random width between 50% and 90%
	const width = `${Math.floor(Math.random() * 40) + 50}%`;
</script>

<div
	bind:this={ref}
	data-slot="sidebar-menu-skeleton"
	data-sidebar="menu-skeleton"
	class={cn('ui-shell-nav-row ui-sidebar-item-radius min-h-9 gap-2.5 px-2.5', className)}
	{...restProps}
>
	{#if showIcon}
		<Skeleton class="ui-radius-tight size-5" data-sidebar="menu-skeleton-icon" />
	{/if}
	<Skeleton
		class="h-4 max-w-(--skeleton-width) flex-1"
		data-sidebar="menu-skeleton-text"
		style="--skeleton-width: {width};"
	/>
	{@render children?.()}
</div>
