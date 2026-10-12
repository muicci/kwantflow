<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FileIcon from '@lucide/svelte/icons/file';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { ProjectStatus } from '$lib/constants/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { appTabsState } from '$lib/state/app-tabs.svelte.js';
	import { explorerState } from '$lib/state/explorer.svelte.js';
	import { buildExplorerVisibleProjects } from './app-sidebar-explorer-panel.helpers.js';

	let { dismissMobileSidebar = () => {} }: { dismissMobileSidebar?: () => void } = $props();

	let expandedProjectIds = $state.raw<string[]>([]);
	let collapsedAssetIds = $state.raw<string[]>([]);
	let hasHydratedTreeState = $state(false);

	const searchQuery = $derived(appState.sidebarExplorerSearchQuery);
	const searchActive = $derived(searchQuery.trim().length > 0);
	const activeFileId = $derived(
		appTabsState.activeTab?.kind === 'file-preview' ? appTabsState.activeTab.fileId : null
	);
	const visibleProjects = $derived(
		buildExplorerVisibleProjects(explorerState.projects, explorerState.projectChildren, searchQuery)
	);
	const searchLoading = $derived(searchActive && explorerState.isPreparingSearchTree);

	function isProjectExpanded(projectId: string): boolean {
		return expandedProjectIds.includes(projectId);
	}

	function isProjectLoading(projectId: string): boolean {
		return explorerState.isProjectLoading(projectId);
	}

	function isAssetCollapsed(assetId: string): boolean {
		return collapsedAssetIds.includes(assetId);
	}

	function toggleProject(projectId: string): void {
		if (searchActive) return;

		if (isProjectExpanded(projectId)) {
			expandedProjectIds = expandedProjectIds.filter((id) => id !== projectId);
			return;
		}

		expandedProjectIds = [...expandedProjectIds, projectId];
		void explorerState.loadProjectBranch(projectId);
	}

	function toggleAsset(assetId: string): void {
		if (searchActive) return;

		if (isAssetCollapsed(assetId)) {
			collapsedAssetIds = collapsedAssetIds.filter((id) => id !== assetId);
			return;
		}

		collapsedAssetIds = [...collapsedAssetIds, assetId];
	}

	onMount(() => {
		void (async () => {
			const explorerTreeState = await appState.getExplorerTreeState();
			expandedProjectIds = [...new Set(explorerTreeState.expandedProjectIds)];
			collapsedAssetIds = [...new Set(explorerTreeState.collapsedAssetIds)];
			hasHydratedTreeState = true;
		})();
	});

	$effect(() => {
		void explorerState.ensureHydrated();
	});

	$effect(() => {
		void explorerState.prepareSearchTree(searchQuery);
	});

	$effect(() => {
		if (!hasHydratedTreeState || searchActive) return;

		for (const projectId of expandedProjectIds) {
			if (
				explorerState.projectChildren[projectId]?.loaded ||
				explorerState.isProjectLoading(projectId)
			) {
				continue;
			}

			void explorerState.loadProjectBranch(projectId);
		}
	});

	$effect(() => {
		if (!hasHydratedTreeState) return;

		void appState.setExplorerTreeState({
			expandedProjectIds,
			collapsedAssetIds
		});
	});
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="shrink-0 px-2 pb-2">
		<Sidebar.Input
			value={appState.sidebarExplorerSearchQuery}
			placeholder="Search..."
			aria-label="Search"
			oninput={(event) => {
				appState.setSidebarExplorerSearchQuery((event.currentTarget as HTMLInputElement).value);
			}}
		/>
	</div>

	<div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
		{#if searchLoading}
			<div class="flex items-center gap-2 px-2 py-3">
				<LoaderIcon class="size-3.5 animate-spin" />
				<Meta as="span">Searching files…</Meta>
			</div>
		{:else if visibleProjects.length === 0}
			<Meta class="px-2 py-3">
				{searchActive ? 'No matching files.' : 'No local files yet.'}
			</Meta>
		{:else}
			<Sidebar.Menu>
				{#each visibleProjects as entry (entry.project.id)}
					{@const showChildren =
						searchActive || isProjectExpanded(entry.project.id) || entry.matchesSearch}
					{@const branchLoaded = explorerState.projectChildren[entry.project.id]?.loaded ?? false}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							class="shell-nav-copy h-auto gap-2 py-1.5"
							onclick={() => toggleProject(entry.project.id)}
						>
							{#if showChildren}
								<ChevronDownIcon class="size-4 shrink-0" />
							{:else}
								<ChevronRightIcon class="size-4 shrink-0" />
							{/if}
							<Meta as="span" class="flex size-4 shrink-0 items-center justify-center">
								<FolderIcon class="size-4" />
							</Meta>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Text
									as="span"
									class={`min-w-0 flex-1 truncate text-start ${
										entry.project.status === ProjectStatus.Archived ? 'muted' : ''
									}`}
								>
									{entry.project.rfq_number}
								</Text>
								{#if entry.project.status === ProjectStatus.Archived}
									<span class="badge-label muted shrink-0">Archived</span>
								{/if}
							</div>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>

					{#if showChildren}
						<div class="mt-0.5 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
							{#if isProjectLoading(entry.project.id) || !branchLoaded}
								<div class="flex items-center gap-2 px-2 py-1.5">
									<LoaderIcon class="size-3.5 animate-spin" />
									<Meta as="span">Loading files…</Meta>
								</div>
							{:else}
								{#each entry.assets as assetEntry (assetEntry.asset.id)}
									{@const showAssetFiles = searchActive || !isAssetCollapsed(assetEntry.asset.id)}
									<button
										type="button"
										class="shell-nav-copy ui-shell-nav-row ui-shell-nav-tone ui-sidebar-item-radius flex w-full min-w-0 items-center gap-2 py-1.5 text-left"
										onclick={() => toggleAsset(assetEntry.asset.id)}
									>
										{#if showAssetFiles}
											<ChevronDownIcon class="size-4 shrink-0" />
										{:else}
											<ChevronRightIcon class="size-4 shrink-0" />
										{/if}
										<Meta as="span" class="flex size-4 shrink-0 items-center justify-center">
											{#if showAssetFiles}
												<FolderOpenIcon class="size-4" />
											{:else}
												<FolderIcon class="size-4" />
											{/if}
										</Meta>
										<Text as="span" class="min-w-0 flex-1 truncate">
											{assetEntry.asset.display_name}
										</Text>
									</button>

									{#if showAssetFiles && assetEntry.files.length > 0}
										<div class="ml-4 space-y-0.5 border-l border-sidebar-border/70 pl-2">
											{#each assetEntry.files as file (file.id)}
												{@const isActiveFile = activeFileId === file.id}
												<a
													href={resolve(`/preview/file/${file.id}`)}
													class={`shell-nav-copy ui-shell-nav-row ui-shell-nav-tone ui-sidebar-item-radius flex w-full min-w-0 items-center gap-2 py-1.5 text-left ${
														isActiveFile
															? 'surface-sidebar-accent text-sidebar-accent-foreground'
															: 'hover-surface-sidebar-accent'
													}`}
													onclick={dismissMobileSidebar}
												>
													<Meta as="span" class="flex size-4 shrink-0 items-center justify-center">
														<FileIcon class="size-4" />
													</Meta>
													<Text as="span" class="min-w-0 flex-1 truncate">
														{file.original_name}
													</Text>
												</a>
											{/each}
										</div>
									{/if}
								{/each}

								{#each entry.unassignedFiles as file (file.id)}
									{@const isActiveFile = activeFileId === file.id}
									<a
										href={resolve(`/preview/file/${file.id}`)}
										class={`shell-nav-copy ui-shell-nav-row ui-shell-nav-tone ui-sidebar-item-radius flex w-full min-w-0 items-center gap-2 py-1.5 text-left ${
											isActiveFile
												? 'surface-sidebar-accent text-sidebar-accent-foreground'
												: 'hover-surface-sidebar-accent'
										}`}
										onclick={dismissMobileSidebar}
									>
										<Meta as="span" class="flex size-4 shrink-0 items-center justify-center">
											<FileIcon class="size-4" />
										</Meta>
										<Text as="span" class="min-w-0 flex-1 truncate">
											{file.original_name}
										</Text>
									</a>
								{/each}

								{#if branchLoaded && entry.assets.length === 0 && entry.unassignedFiles.length === 0}
									<Meta class="px-2 py-2">
										{searchActive
											? 'No matching files in this RFQ.'
											: 'No uploaded files in this RFQ.'}
									</Meta>
								{/if}
							{/if}
						</div>
					{/if}
				{/each}
			</Sidebar.Menu>
		{/if}
	</div>
</div>
