<script lang="ts">
	import AppSidebarPanelRail from './app-sidebar-panel-rail.svelte';
	import AppSidebarExplorerPanel from './app-sidebar-explorer-panel.svelte';
	import AppSidebarMailPanel from './app-sidebar-mail-panel.svelte';
	import AppSidebarPagesPanel from './app-sidebar-pages-panel.svelte';
	import AppSidebarProjectsPanel from './app-sidebar-projects-panel.svelte';
	import NavUser from './nav-user.svelte';
	import Stack from '$lib/components/primitives/stack.svelte';

	import { resolve } from '$app/paths';
	import sidebarLogoUrl from '$lib/assets/branding/kwantflow-logo-app.svg';
	import { appState } from '$lib/state/app.svelte.js';
	import { accountState } from '$lib/state/account.svelte.js';
	import type { AppShellCreateActionId } from '$lib/state/app-tabs.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import type { ComponentProps } from 'svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let {
		useNativeShellHeader = false,
		onRequestNewRfq = () => {},
		onRequestQuickCreate = () => {},
		onRequestEditProject = () => {},
		onRequestDeleteProject = () => {},
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & {
		useNativeShellHeader?: boolean;
		onRequestNewRfq?: () => void;
		onRequestQuickCreate?: (actionId: AppShellCreateActionId) => void;
		onRequestEditProject?: (projectId: string) => void;
		onRequestDeleteProject?: (projectId: string) => void;
	} = $props();

	const sidebar = Sidebar.useSidebar();

	const nativeShellInsetClass = $derived.by(() => {
		if (!useNativeShellHeader) return '';
		return sidebar.isMobile ? 'pt-8' : '';
	});

	function dismissMobileSidebar(): void {
		if (!sidebar.isMobile) return;
		sidebar.setOpenMobile(false);
	}

	function runSidebarAction(action: () => void): void {
		dismissMobileSidebar();
		action();
	}
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	{#if !useNativeShellHeader}
		<Sidebar.Header>
			<Sidebar.Menu class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						size="lg"
						class="hover:bg-transparent active:bg-transparent data-[slot=sidebar-menu-button]:p-1.5!"
						aria-label="Open Kwantflow"
					>
						{#snippet child({ props })}
							<a href={resolve('/')} {...props}>
								<img
									src={sidebarLogoUrl}
									alt="Kwantflow"
									class="brand-logo block h-4 w-auto shrink-0 object-contain"
									decoding="async"
									draggable="false"
								/>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Header>
	{/if}
	<Sidebar.Content>
		<Stack gap="0" class={`min-h-0 flex-1 ${nativeShellInsetClass}`.trim()}>
			<AppSidebarPanelRail />
			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				{#if appState.activeSidebarPanel === 'pages'}
					<AppSidebarPagesPanel
						{dismissMobileSidebar}
						onRequestQuickCreate={(actionId) => {
							runSidebarAction(() => onRequestQuickCreate(actionId));
						}}
					/>
				{:else if appState.activeSidebarPanel === 'mail'}
					<AppSidebarMailPanel />
				{:else if appState.activeSidebarPanel === 'projects'}
					<AppSidebarProjectsPanel
						{dismissMobileSidebar}
						onRequestNewRfq={() => {
							runSidebarAction(onRequestNewRfq);
						}}
						onRequestEditProject={(project) => {
							runSidebarAction(() => onRequestEditProject(project.id));
						}}
						onRequestDeleteProject={(project) => {
							runSidebarAction(() => onRequestDeleteProject(project.id));
						}}
					/>
				{:else}
					<AppSidebarExplorerPanel {dismissMobileSidebar} />
				{/if}
			</div>
		</Stack>
	</Sidebar.Content>
	{#if !useNativeShellHeader}
		<Sidebar.Footer>
			<NavUser
				user={{
					name: workspaceState.displayName || workspaceState.businessName || 'Workspace',
					email: accountState.accountEmail,
					avatar: accountState.avatarUrl
				}}
			/>
		</Sidebar.Footer>
	{/if}
</Sidebar.Root>
