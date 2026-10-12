<script lang="ts">
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { createLogger } from '$lib/services/logger.js';
	import { cn } from '$lib/utils.js';

	let { ariaLabel = 'Toggle sidebar' }: { ariaLabel?: string } = $props();

	const log = createLogger('sidebarToggle');
	const sidebar = useSidebar();
	const resolvedAriaLabel = $derived(
		ariaLabel === 'Toggle sidebar' ? (sidebar.open ? 'Close sidebar' : 'Open sidebar') : ariaLabel
	);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<div
				{...props}
				role="button"
				tabindex="0"
				class={cn(
					buttonVariants({ variant: 'ghost', size: 'icon' }),
					'ui-radius-md size-7 transition-colors',
					sidebar.open
						? 'surface-accent-selected'
						: 'muted hover-surface-accent-strong hover:text-accent-foreground'
				)}
				aria-label={resolvedAriaLabel}
				onclickcapture={(e) => {
					if (!e.isTrusted) {
						log.warn('[AppShellSidebarToggle] Blocked untrusted click');
						return;
					}
					e.stopPropagation();
					log.info('[AppShellSidebarToggle] onclick triggered', { open: sidebar.open });
					sidebar.toggle();
				}}
				onkeydown={(e) => {
					if (!e.isTrusted) {
						log.warn('[AppShellSidebarToggle] Blocked untrusted keydown');
						return;
					}
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						log.info('[AppShellSidebarToggle] onkeydown triggered', { open: sidebar.open });
						sidebar.toggle();
					}
				}}
			>
				<PanelLeftIcon class="size-4" />
				<span class="sr-only">{resolvedAriaLabel}</span>
			</div>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side="bottom" sideOffset={4}>
		{resolvedAriaLabel}
	</Tooltip.Content>
</Tooltip.Root>
