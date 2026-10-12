<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		children,
		child,
		class: className,
		size = 'md',
		isActive = false,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		size?: 'sm' | 'md';
		isActive?: boolean;
	} = $props();

	const mergedProps = $derived({
		class: cn(
			'ui-sidebar-nav-button shell-nav-copy ui-shell-nav-tone ui-shell-nav-row ui-sidebar-item-radius ring-sidebar-ring hover-surface-sidebar-accent hover:text-sidebar-accent-foreground flex min-w-0 -translate-x-px overflow-hidden outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground/70',
			size === 'sm' && 'control-copy-sm min-h-7 py-1',
			size === 'md' && 'min-h-9',
			'group-data-[collapsible=icon]:hidden',
			className
		),
		'data-slot': 'sidebar-menu-sub-button',
		'data-sidebar': 'menu-sub-button',
		'data-size': size,
		'data-active': isActive,
		...restProps
	});
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<a bind:this={ref} {...mergedProps}>
		{@render children?.()}
	</a>
{/if}
