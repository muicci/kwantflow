<!-- Codebase review improvements: Converted inline styles to style: directives for CSP compliance and replaced muted with semantic .muted class. -->
<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import { SIDEBAR_WIDTH_MOBILE } from './constants.js';
	import { useSidebar } from './context.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { tick } from 'svelte';

	let {
		ref = $bindable(null),
		side = 'left',
		variant = 'sidebar',
		collapsible = 'offcanvas',
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		side?: 'left' | 'right';
		variant?: 'sidebar' | 'floating' | 'inset';
		collapsible?: 'offcanvas' | 'icon' | 'none';
	} = $props();

	const sidebar = useSidebar();

	$effect(() => {
		if (sidebar.open && ref) {
			tick().then(() => {
				if (!ref) return;
				setTimeout(() => {
					if (!ref || !ref.isConnected || !sidebar.open) return;
					if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
					const rect = ref.getBoundingClientRect();
					const style = window.getComputedStyle(ref);
					if (style.display === 'none' || rect.width === 0) {
						errorState.captureLayoutWarning('Sidebar remains hidden despite open state', {
							className: ref.className,
							display: style.display,
							width: style.width,
							rectWidth: rect.width
						});
					}
				}, 300);
			});
		}
	});
</script>

{#if collapsible === 'none'}
	<div
		class={cn('ui-sidebar-shell h-full w-(--sidebar-width)', className)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
{:else if sidebar.isMobile}
	<Sheet.Root bind:open={() => sidebar.openMobile, (v) => sidebar.setOpenMobile(v)} {...restProps}>
		<Sheet.Content
			data-sidebar="sidebar"
			data-slot="sidebar"
			data-mobile="true"
			class="ui-sidebar-shell w-(--sidebar-width) p-0 [&>button]:hidden"
			style="--sidebar-width: {SIDEBAR_WIDTH_MOBILE};"
			{side}
		>
			<Sheet.Header class="sr-only">
				<Sheet.Title>Sidebar</Sheet.Title>
				<Sheet.Description>Displays the mobile sidebar.</Sheet.Description>
			</Sheet.Header>
			<div class="ui-sidebar-inner">
				{@render children?.()}
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<div
		bind:this={ref}
		class="group peer block text-sidebar-foreground"
		data-state={sidebar.state}
		data-collapsible={sidebar.state === 'collapsed' ? collapsible : ''}
		data-variant={variant}
		data-side={side}
		data-slot="sidebar"
	>
		<!-- This is what handles the sidebar gap on desktop -->
		<div
			data-slot="sidebar-gap"
			class={cn(
				'relative w-(--sidebar-width) bg-transparent',
				'group-data-[collapsible=offcanvas]:w-0',
				'group-data-[side=right]:rotate-180',
				variant === 'floating' || variant === 'inset'
					? 'group-data-[collapsible=icon]:ui-sidebar-icon-width'
					: 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)'
			)}
			style="transition: width var(--duration-fast) var(--ease-standard);"
		></div>
		<div
			data-slot="sidebar-container"
			class={cn(
				'fixed top-10 bottom-0 z-10 flex w-(--sidebar-width)',
				side === 'left'
					? 'start-0 group-data-[collapsible=offcanvas]:start-[calc(var(--sidebar-width)*-1)]'
					: 'end-0 group-data-[collapsible=offcanvas]:end-[calc(var(--sidebar-width)*-1)]',
				// Adjust the padding for floating and inset variants.
				variant === 'floating' || variant === 'inset'
					? 'group-data-[collapsible=icon]:ui-sidebar-icon-width p-2'
					: 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-e group-data-[side=right]:border-s',
				className
			)}
			style="transition: left var(--duration-fast) var(--ease-standard), right var(--duration-fast) var(--ease-standard), width var(--duration-fast) var(--ease-standard);"
			{...restProps}
		>
			<div
				data-sidebar="sidebar"
				data-slot="sidebar-inner"
				class="ui-sidebar-shell ui-sidebar-inner group-data-[variant=floating]:ui-radius-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border"
			>
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
