<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import TruckIcon from '@lucide/svelte/icons/truck';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FileSignatureIcon from '@lucide/svelte/icons/file-signature';
	import ClipboardIcon from '@lucide/svelte/icons/clipboard';
	import ListTreeIcon from '@lucide/svelte/icons/list-tree';
	import ComponentIcon from '@lucide/svelte/icons/component';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import UserCogIcon from '@lucide/svelte/icons/user-cog';
	import { Meta } from '$lib/components/primitives/index.js';
	import type { AppShellCreateActionId, AppTopLevelTabId } from '$lib/state/app-tabs.svelte.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { filterSidebarPageDestinations } from '$lib/utils/sidebar-panel-filters.js';
	import { isRfqHomeRoute, normaliseAppPathname } from '$lib/utils/route-path.js';
	import type { AppShellHref } from '$lib/utils/app-shell-href.js';

	const pageIcons: Record<AppTopLevelTabId, typeof FolderIcon> = {
		rfqs: FolderIcon,
		companies: ContactIcon,
		materials: ComponentIcon,
		'labour-rates': UserCogIcon,
		'equipment-rates': TruckIcon,
		'subcontract-rates': FileSignatureIcon,
		'cost-presets': SlidersHorizontalIcon,
		'estimate-templates': ClipboardIcon,
		classification: ListTreeIcon
	};

	const filteredDestinations = $derived(
		filterSidebarPageDestinations(appState.sidebarPagesSearchQuery, appState.hiddenSetupPageIds)
	);
	const pathname = $derived(normaliseAppPathname(page.url.pathname));
	const routeId = $derived(page.route.id ?? '');

	let {
		dismissMobileSidebar = () => {},
		onRequestQuickCreate = () => {}
	}: {
		dismissMobileSidebar?: () => void;
		onRequestQuickCreate?: (actionId: AppShellCreateActionId) => void;
	} = $props();

	function isDestinationActive(destinationId: AppTopLevelTabId, route: AppShellHref): boolean {
		if (destinationId === 'rfqs') {
			return isRfqHomeRoute(pathname, routeId);
		}

		if (destinationId === 'classification') {
			return pathname.startsWith('/classification-systems');
		}

		return pathname === route;
	}

	function requestQuickCreate(
		event: MouseEvent | KeyboardEvent,
		actionId: AppShellCreateActionId
	): void {
		event.preventDefault();
		event.stopPropagation();
		dismissMobileSidebar();
		onRequestQuickCreate(actionId);
	}

	function getCreateActionId(
		destination:
			| (typeof filteredDestinations.primary)[number]
			| (typeof filteredDestinations.estimating)[number]
	): AppShellCreateActionId | null {
		return 'createActionId' in destination && destination.createActionId
			? destination.createActionId
			: null;
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="shrink-0 px-2 pb-2">
		<Sidebar.Input
			value={appState.sidebarPagesSearchQuery}
			placeholder="Search..."
			aria-label="Search"
			oninput={(event) => {
				appState.setSidebarPagesSearchQuery((event.currentTarget as HTMLInputElement).value);
			}}
		/>
	</div>
	<div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
		<Sidebar.Menu>
			{#each filteredDestinations.primary as destination (destination.id)}
				{@const Icon = pageIcons[destination.id]}
				{@const createActionId = getCreateActionId(destination)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={isDestinationActive(destination.id, destination.route)}>
						{#snippet child({ props })}
							<a href={resolve(destination.route)} {...props} onclick={dismissMobileSidebar}>
								<Icon strokeWidth={1.5} />
								<span>{destination.title}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
					{#if createActionId}
						<Sidebar.MenuAction
							showOnHover
							aria-label={`Create ${destination.title}`}
							onclick={(event) => requestQuickCreate(event, createActionId)}
						>
							<PlusIcon strokeWidth={1.5} />
							<span class="sr-only">Create {destination.title}</span>
						</Sidebar.MenuAction>
					{/if}
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>

		{#if filteredDestinations.estimating.length > 0}
			<div class="mt-2 space-y-2">
				<Sidebar.Separator />
				<p class="eyebrow px-2">Estimating</p>
				<Sidebar.Menu>
					{#each filteredDestinations.estimating as destination (destination.id)}
						{@const Icon = pageIcons[destination.id]}
						{@const createActionId = getCreateActionId(destination)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={isDestinationActive(destination.id, destination.route)}>
								{#snippet child({ props })}
									<a href={resolve(destination.route)} {...props} onclick={dismissMobileSidebar}>
										<Icon strokeWidth={1.5} />
										<span>{destination.title}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
							{#if createActionId}
								<Sidebar.MenuAction
									showOnHover
									aria-label={`Create ${destination.title}`}
									onclick={(event) => requestQuickCreate(event, createActionId)}
								>
									<PlusIcon strokeWidth={1.5} />
									<span class="sr-only">Create {destination.title}</span>
								</Sidebar.MenuAction>
							{/if}
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</div>
		{/if}

		{#if filteredDestinations.primary.length === 0 && filteredDestinations.estimating.length === 0}
			<Meta class="px-2 py-3">No matching pages.</Meta>
		{/if}
	</div>
</div>
