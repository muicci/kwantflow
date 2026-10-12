<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import ProjectActionsMenu from '$lib/components/project-actions-menu.svelte';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { splitSidebarProjects } from '$lib/utils/sidebar-panel-filters.js';
	import {
		getProjectCompanyDisplayName,
		getProjectRequesterDisplayName
	} from '$lib/utils/project-contact.js';
	import { normaliseAppPathname } from '$lib/utils/route-path.js';

	let {
		dismissMobileSidebar = () => {},
		onRequestNewRfq = () => {},
		onRequestEditProject = () => {},
		onRequestDeleteProject = () => {}
	}: {
		dismissMobileSidebar?: () => void;
		onRequestNewRfq?: () => void;
		onRequestEditProject?: (project: (typeof projectsState.list)[number]) => void;
		onRequestDeleteProject?: (project: (typeof projectsState.list)[number]) => void;
	} = $props();

	const pathname = $derived(normaliseAppPathname(page.url.pathname));
	const projectSections = $derived(
		splitSidebarProjects(
			projectsState.list,
			projectsState.recent,
			appState.sidebarProjectsSearchQuery
		)
	);
	const emptyProjectsMessage = $derived(
		projectsState.list.length > 0 ? 'No matching RFQs.' : 'No RFQs yet'
	);

	function prepareOpenProject(project: (typeof projectsState.list)[number]): void {
		dismissMobileSidebar();
		void projectsState.setActive(project);
		appState.prepareForWorkspaceEntry();
	}

	function isProjectRouteActive(projectId: string): boolean {
		return pathname === `/project/${projectId}` || pathname.startsWith(`/project/${projectId}/`);
	}

	function getProjectMeta(project: (typeof projectsState.list)[number]): string {
		const company = getProjectCompanyDisplayName(project)?.trim();
		const requester = getProjectRequesterDisplayName(project)?.trim();
		if (company && requester) return `${company} · ${requester}`;
		if (company) return company;
		if (project.project_name?.trim()) return project.project_name.trim();
		return 'No company';
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="shrink-0 space-y-2 px-2 pb-2">
		<Sidebar.Input
			value={appState.sidebarProjectsSearchQuery}
			placeholder="Search..."
			aria-label="Search"
			oninput={(event) => {
				appState.setSidebarProjectsSearchQuery((event.currentTarget as HTMLInputElement).value);
			}}
		/>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={onRequestNewRfq}>
					<FolderPlusIcon class="size-4 shrink-0" />
					<span>New RFQ</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</div>
	<div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
		{#if projectSections.favourites.length === 0 && projectSections.recent.length === 0}
			<Meta class="px-2 py-3">{emptyProjectsMessage}</Meta>
		{:else}
			<div class="mb-2">
				<Sidebar.Separator />
			</div>
			{#if projectSections.favourites.length > 0}
				<div class="space-y-1.5">
					<Sidebar.GroupLabel class="px-2">Favourites</Sidebar.GroupLabel>
					<Sidebar.Menu>
						{#each projectSections.favourites as project (project.id)}
							<Sidebar.MenuItem
								class={`ui-sidebar-item-radius transition-colors ${
									isProjectRouteActive(project.id)
										? 'surface-sidebar-accent text-sidebar-accent-foreground'
										: 'hover-surface-sidebar-accent hover:text-sidebar-accent-foreground'
								}`}
							>
								<Sidebar.MenuButton
									class="!h-auto min-h-12 items-start gap-2.5 px-2.5 py-2"
									isActive={isProjectRouteActive(project.id)}
								>
									{#snippet child({ props })}
										<a
											href={resolve(`/project/${project.id}`)}
											{...props}
											onclick={() => prepareOpenProject(project)}
										>
											<FolderIcon class="mt-0.5 size-4 shrink-0" />
											<div class="grid min-w-0 flex-1 gap-0.5 text-start">
												<Text as="span" class="truncate">{project.rfq_number}</Text>
												<Meta as="span" class="truncate">{getProjectMeta(project)}</Meta>
											</div>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
								<ProjectActionsMenu
									{project}
									dropdownAlign="end"
									onAction={dismissMobileSidebar}
									onEditRequest={onRequestEditProject}
									onDeleteRequest={onRequestDeleteProject}
								>
									{#snippet triggerSnippet({ props })}
										<Sidebar.MenuAction showOnHover {...props} aria-label="RFQ actions">
											<EllipsisIcon />
											<span class="sr-only">RFQ actions</span>
										</Sidebar.MenuAction>
									{/snippet}
								</ProjectActionsMenu>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</div>
			{/if}

			{#if projectSections.recent.length > 0}
				<div class="mt-2 space-y-1.5">
					{#if projectSections.favourites.length > 0}
						<Sidebar.Separator />
					{/if}
					<Sidebar.Menu>
						{#each projectSections.recent as project (project.id)}
							<Sidebar.MenuItem
								class={`ui-sidebar-item-radius transition-colors ${
									isProjectRouteActive(project.id)
										? 'surface-sidebar-accent text-sidebar-accent-foreground'
										: 'hover-surface-sidebar-accent hover:text-sidebar-accent-foreground'
								}`}
							>
								<Sidebar.MenuButton
									class="!h-auto min-h-12 items-start gap-2.5 px-2.5 py-2"
									isActive={isProjectRouteActive(project.id)}
								>
									{#snippet child({ props })}
										<a
											href={resolve(`/project/${project.id}`)}
											{...props}
											onclick={() => prepareOpenProject(project)}
										>
											<FolderIcon class="mt-0.5 size-4 shrink-0" />
											<div class="grid min-w-0 flex-1 gap-0.5 text-start">
												<Text as="span" class="truncate">{project.rfq_number}</Text>
												<Meta as="span" class="truncate">{getProjectMeta(project)}</Meta>
											</div>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
								<ProjectActionsMenu
									{project}
									dropdownAlign="end"
									onAction={dismissMobileSidebar}
									onEditRequest={onRequestEditProject}
									onDeleteRequest={onRequestDeleteProject}
								>
									{#snippet triggerSnippet({ props })}
										<Sidebar.MenuAction showOnHover {...props} aria-label="RFQ actions">
											<EllipsisIcon />
											<span class="sr-only">RFQ actions</span>
										</Sidebar.MenuAction>
									{/snippet}
								</ProjectActionsMenu>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</div>
			{/if}
		{/if}
	</div>
</div>
