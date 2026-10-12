<script lang="ts">
	import Columns2Icon from '@lucide/svelte/icons/columns-2';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { cn } from '$lib/utils.js';

	import { createLogger } from '$lib/services/logger.js';

	let { sizeClass = 'size-7', iconClass = 'size-3.5' }: { sizeClass?: string; iconClass?: string } =
		$props();

	const log = createLogger('workspaceRailToggle');
	const isMobileViewport = new IsMobile();
	const isOpen = $derived(
		isMobileViewport.current ? appState.isWorkspaceRailMobileOpen : appState.isWorkspaceRailOpen
	);
	const label = $derived(isOpen ? 'Hide workspace navigation' : 'Show workspace navigation');

	function handleToggle(): void {
		void appState.toggleWorkspaceRail({ mobile: isMobileViewport.current });
	}
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
					sizeClass,
					'ui-radius-md transition-colors',
					isOpen
						? 'surface-accent-selected'
						: 'muted hover-surface-accent-strong hover:text-accent-foreground'
				)}
				onclickcapture={(e) => {
					if (!e.isTrusted) {
						log.warn('[WorkspaceRailToggle] Blocked untrusted click');
						return;
					}
					e.stopPropagation();
					log.info('[WorkspaceRailToggle] onclick triggered', { isOpen });
					handleToggle();
				}}
				onkeydown={(e) => {
					if (!e.isTrusted) {
						log.warn('[WorkspaceRailToggle] Blocked untrusted keydown');
						return;
					}
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						log.info('[WorkspaceRailToggle] onkeydown triggered', { isOpen });
						handleToggle();
					}
				}}
			>
				<Columns2Icon class={iconClass} />
				<span class="sr-only">{label}</span>
			</div>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side="bottom" sideOffset={4}>
		{label}
	</Tooltip.Content>
</Tooltip.Root>
