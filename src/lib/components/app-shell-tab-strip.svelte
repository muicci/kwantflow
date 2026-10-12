<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import StarIcon from '@lucide/svelte/icons/star';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import { Meta } from '$lib/components/primitives/index.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import type { OptionalSetupPageId } from '$lib/constants/setup-page-visibility.js';
	import type { Project } from '$lib/types/index.js';
	import AiTaskCentre from '$lib/components/ai-task-centre.svelte';
	import AskKwantflowButton from '$lib/components/ask-kwantflow-button.svelte';
	import AppShellSidebarToggle from '$lib/components/app-shell-sidebar-toggle.svelte';
	import NavUser from '$lib/components/nav-user.svelte';
	import WorkspaceRailToggle from '$lib/components/workspace-rail-toggle.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { DragDropProvider } from '@dnd-kit-svelte/svelte';
	import { useSortable } from '@dnd-kit-svelte/svelte/sortable';
	import { move } from '@dnd-kit/helpers';
	import { RestrictToHorizontalAxis } from '@dnd-kit/abstract/modifiers';
	import type { DragEndEvent } from '@dnd-kit/abstract';
	import {
		APP_SHELL_PAGE_DESTINATIONS,
		appTabsState,
		type AppTabRecord
	} from '$lib/state/app-tabs.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { projectRevisionHistoryState } from '$lib/state/project-revision-history.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { computeTabStripLayout } from '$lib/components/app-shell-tab-strip.layout.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import type { AppShellHref } from '$lib/utils/app-shell-href.js';
	import { startNativeWindowDrag } from '$lib/utils/window-drag.js';
	import { formatDate } from '$lib/utils/format.js';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const DndProvider = DragDropProvider as any;

	let {
		project = null,
		user,
		pathname
	}: {
		project?: Project | null;
		user: { name: string; email: string; avatar: string };
		pathname: string;
	} = $props();

	const tabs = $derived(appTabsState.tabs);
	const activeTabId = $derived(appTabsState.activeTabId);
	const recentProjects = $derived(projectsState.recent.slice(0, 5));
	const visiblePageDestinations = $derived(
		APP_SHELL_PAGE_DESTINATIONS.filter(
			(destination) => !appState.hiddenSetupPageIds.includes(destination.id as OptionalSetupPageId)
		)
	);
	const isMobileViewport = new IsMobile();
	let tabRailWidth = $state(0);
	const tabLayout = $derived(
		computeTabStripLayout({
			tabs,
			activeTabId,
			availableWidthPx: tabRailWidth
		})
	);
	const visibleTabs = $derived(tabLayout.visibleTabs);
	const overflowTabs = $derived(tabLayout.overflowTabs);
	let confirmCloseTab: AppTabRecord | null = $state(null);
	let confirmCloseDialogOpen = $state(false);
	const isTabReorderDisabled = $derived(
		isMobileViewport.current || visibleTabs.length <= 1 || tabs.length <= 1
	);
	function navigateToRoute(route: string): void {
		void goto(resolve(route as AppShellHref));
	}

	function activateTab(tab: AppTabRecord): void {
		if (tab.id === activeTabId && pathname === tab.route) return;
		navigateToRoute(tab.route);
	}

	function handleTabKeydown(tab: AppTabRecord, event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		activateTab(tab);
	}

	function requestClose(tab: AppTabRecord): void {
		if (tab.kind === 'project' && tab.dirty) {
			confirmCloseTab = tab;
			confirmCloseDialogOpen = true;
			return;
		}

		void closeTab(tab);
	}

	function openDestination(route: string): void {
		navigateToRoute(route);
	}

	function reorderVisibleTabs(orderedVisibleIds: AppTabRecord['id'][]): void {
		if (orderedVisibleIds.length <= 1) return;

		const visibleIdSet = new Set(visibleTabs.map((tab) => tab.id));
		const reorderedQueue = [...orderedVisibleIds];
		const nextOrderedIds: AppTabRecord['id'][] = tabs.map((tab) =>
			visibleIdSet.has(tab.id) ? (reorderedQueue.shift() ?? tab.id) : tab.id
		);

		appTabsState.reorderTabs(nextOrderedIds);
	}

	function handleDragEnd(event: DragEndEvent): void {
		if (isTabReorderDisabled) return;

		// @ts-expect-error - Event type mismatch from library
		const reorderedVisibleIds = move(visibleTabs, event).map((tab) => tab.id);
		if (
			reorderedVisibleIds.length === 0 ||
			reorderedVisibleIds.every((id, index) => id === visibleTabs[index]?.id)
		) {
			return;
		}

		reorderVisibleTabs(reorderedVisibleIds);
	}

	async function closeTab(tab: AppTabRecord): Promise<void> {
		const isActive = tab.id === activeTabId;
		if (!isActive) {
			appTabsState.close(tab.id);
			return;
		}

		const fallbackTab = appTabsState.getCloseFallbackTab(tab.id);
		if (!fallbackTab) {
			appTabsState.close(tab.id);
			return;
		}

		if (tab.kind === 'project') {
			appTabsState.approveProjectTabClose(tab.projectId);
		}

		appTabsState.queuePendingClose(tab.id);
		if (fallbackTab.route === pathname) {
			appTabsState.finalisePendingClose();
			return;
		}

		await goto(resolve(fallbackTab.route as AppShellHref));
	}
</script>

{#snippet SortableTab({ tab, index }: { tab: AppTabRecord; index: number })}
	{@const { ref, isDragging, handleRef } = useSortable({
		id: tab.id,
		index: () => index,
		disabled: () => isTabReorderDisabled
	})}
	<div
		class={`group ui-tab-shell control-height-sm w-32 max-w-40 min-w-32 shrink-0 ${
			tab.id === activeTabId ? 'ui-tab-shell-active' : 'ui-tab-shell-inactive'
		} ${isDragging.current ? 'ui-tab-shell-dragging' : ''}`}
		data-dragging={isDragging.current}
		role="tab"
		tabindex="0"
		aria-current={tab.id === activeTabId ? 'page' : undefined}
		aria-label={`Open ${tab.title} tab`}
		onclick={() => activateTab(tab)}
		onkeydown={(event) => handleTabKeydown(tab, event)}
		{@attach ref}
	>
		<span
			class={`ui-radius-tight muted-soft flex size-4 shrink-0 touch-none items-center justify-center transition-[opacity,color] duration-150 ${
				isTabReorderDisabled
					? 'opacity-0'
					: 'cursor-grab opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 active:cursor-grabbing data-[dragging=true]:opacity-100'
			}`}
			aria-label={`Reorder ${tab.title} tab`}
			title="Drag to reorder"
			{@attach handleRef}
		>
			<span class="grid grid-cols-2 gap-0.5" aria-hidden="true">
				<span class="ui-radius-pill size-0.5 bg-current"></span>
				<span class="ui-radius-pill size-0.5 bg-current"></span>
				<span class="ui-radius-pill size-0.5 bg-current"></span>
				<span class="ui-radius-pill size-0.5 bg-current"></span>
			</span>
		</span>
		<span
			class="tab-label flex min-w-0 flex-1 items-center justify-center gap-2 truncate px-2 text-center select-none"
		>
			{#if tab.kind === 'project' && tab.dirty}
				<span class="ui-radius-pill size-1.5 shrink-0 bg-warning"></span>
			{/if}
			<span class="truncate">{tab.title}</span>
		</span>
		<span class="flex size-5 shrink-0 items-center justify-center">
			<button
				type="button"
				class={`ui-tab-close size-5 shrink-0 ${'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}
				aria-label={`Close ${tab.title} tab`}
				onclick={(event) => {
					event.stopPropagation();
					requestClose(tab);
				}}
			>
				<XIcon class="size-3" />
			</button>
		</span>
	</div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="ui-shell-toolbar h-10 shrink-0"
	onmousedown={(event) => void startNativeWindowDrag(event)}
>
	<div class="flex h-full w-14 shrink-0 items-center" aria-hidden="true"></div>
	<div class="ml-2 flex shrink-0 items-center gap-1">
		<AppShellSidebarToggle />
	</div>
	<div
		bind:offsetWidth={tabRailWidth}
		class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
		data-tab-rail
	>
		<DndProvider modifiers={[RestrictToHorizontalAxis]} onDragEnd={handleDragEnd}>
			<div class="chrome-tab-scroll flex min-w-0 items-center gap-1 overflow-x-auto">
				{#each visibleTabs as tab, index (tab.id)}
					{@render SortableTab({ tab, index })}
				{/each}
			</div>
		</DndProvider>
		<div class="flex shrink-0 items-center gap-1" data-tab-rail-actions>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-xs" class="ui-radius-md" type="button">
							<PlusIcon class="size-3.5" />
							<span class="sr-only">Open a new tab</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="ui-radius-lg w-56">
					<DropdownMenu.Label>Open tab</DropdownMenu.Label>
					{#each visiblePageDestinations as destination (destination.id)}
						<DropdownMenu.Item onclick={() => openDestination(destination.route)}>
							{destination.title}
						</DropdownMenu.Item>
					{/each}
					{#if recentProjects.length > 0}
						<DropdownMenu.Separator />
						<DropdownMenu.Label>Recent RFQs</DropdownMenu.Label>
						{#each recentProjects as recentProject (recentProject.id)}
							<DropdownMenu.Item onclick={() => openDestination(`/project/${recentProject.id}`)}>
								{recentProject.rfq_number}
							</DropdownMenu.Item>
						{/each}
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if overflowTabs.length > 0}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-xs" class="ui-radius-md" type="button">
								<EllipsisIcon class="size-3.5" />
								<span class="sr-only">Show all tabs</span>
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="ui-radius-lg w-56">
						<DropdownMenu.Label>Open tabs</DropdownMenu.Label>
						{#each overflowTabs as tab (tab.id)}
							<DropdownMenu.Item onclick={() => activateTab(tab)}>
								<span class="truncate">{tab.title}</span>
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</div>
	<div class="flex shrink-0 items-center gap-1">
		{#if aiState.localAiStatus.installState === 'ready' || aiState.localAiStatus.installState === 'installed'}
			<AiTaskCentre iconButtonClass="size-7 ui-radius-md" />
		{/if}
		{#if pathname.startsWith('/project/') && project}
			<Meta as="span" class="pr-1">
				{project.submission_deadline_at || project.due_date
					? formatDate(project.submission_deadline_at || project.due_date || '')
					: 'No submission deadline'}
			</Meta>
			<Button
				variant="ghost"
				size="icon"
				class="ui-radius-md size-7"
				type="button"
				aria-label={project.is_favourite ? 'Remove from favourites' : 'Add to favourites'}
				onclick={() => void projectsState.toggleFavourite(project.id)}
			>
				<StarIcon class={`size-4 ${project.is_favourite ? 'fill-current text-primary' : ''}`} />
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="ui-radius-md size-7"
							type="button"
						>
							<EllipsisIcon class="size-3.5" />
							<span class="sr-only">Project actions</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="ui-radius-lg w-48">
					<DropdownMenu.Item
						onclick={() => {
							void projectRevisionHistoryState.openForProject(project.id);
						}}
					>
						<HistoryIcon class="muted size-4" />
						<span>Revision History</span>
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<WorkspaceRailToggle />
		{/if}
		{#if !appState.hasInternet}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<div class="flex size-7 items-center justify-center" aria-label="No internet connection">
						<CloudOffIcon class="muted size-4" />
					</div>
				</Tooltip.Trigger>
				<Tooltip.Content side="bottom" sideOffset={4}>
					No internet connection — Gmail and AI downloads unavailable
				</Tooltip.Content>
			</Tooltip.Root>
		{/if}
		<NavUser {user} variant="toolbar" />
		<AskKwantflowButton />
	</div>
</div>

<AlertDialog.Root bind:open={confirmCloseDialogOpen}>
	<AlertDialog.Content class="ui-dialog-size-lg">
		<AlertDialog.Header>
			<AlertDialog.Title>Close tab and discard unsaved estimate changes?</AlertDialog.Title>
			<AlertDialog.Description>
				{confirmCloseTab?.title} has unsaved estimate edits. Close the tab and discard those in-memory
				changes?
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Action
				variant="secondary"
				size="sm"
				onclick={async () => {
					if (!confirmCloseTab) return;
					const tab = confirmCloseTab;
					confirmCloseTab = null;
					confirmCloseDialogOpen = false;
					await closeTab(tab);
				}}
			>
				Close tab
			</AlertDialog.Action>
			<AlertDialog.Cancel
				variant="default"
				size="sm"
				autofocus
				onclick={() => {
					confirmCloseTab = null;
					confirmCloseDialogOpen = false;
				}}
			>
				Keep editing
			</AlertDialog.Cancel>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
