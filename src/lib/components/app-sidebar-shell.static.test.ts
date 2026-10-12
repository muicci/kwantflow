import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('app shell sidebar collapse controls', () => {
	it('preserves app state across dev hot reloads so shell rails do not reset mid-session', () => {
		const appStateSource = readSource('src/lib/state/app.svelte.ts');

		expect(appStateSource).toContain('type AppStateHmrSnapshot =');
		expect(appStateSource).toContain('function captureAppStateHmrSnapshot(state: AppState)');
		expect(appStateSource).toContain('function restoreAppStateHmrSnapshot');
		expect(appStateSource).toContain('if (import.meta.hot?.data?.appStateSnapshot)');
		expect(appStateSource).toContain('import.meta.hot.dispose((data) => {');
		expect(appStateSource).toContain(
			'data.appStateSnapshot = captureAppStateHmrSnapshot(appState);'
		);
		expect(appStateSource).toContain('state.isSidebarOpen = snapshot.isSidebarOpen;');
		expect(appStateSource).toContain('state.isWorkspaceRailOpen = snapshot.isWorkspaceRailOpen;');
		expect(appStateSource).not.toContain('Object.setPrototypeOf');
	});

	it('keeps the native-shell branch explicit on the sidebar component', () => {
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');

		expect(sidebarSource).toContain('useNativeShellHeader = false');
		expect(sidebarSource).toContain('{#if !useNativeShellHeader}');
		expect(sidebarSource).toContain(
			"import AppSidebarPanelRail from './app-sidebar-panel-rail.svelte';"
		);
		expect(sidebarSource).toContain(
			"import AppSidebarPagesPanel from './app-sidebar-pages-panel.svelte';"
		);
		expect(sidebarSource).toContain(
			"import AppSidebarProjectsPanel from './app-sidebar-projects-panel.svelte';"
		);
		expect(sidebarSource).toContain('<Sidebar.Footer>');
		expect(sidebarSource).toContain('const sidebar = Sidebar.useSidebar();');
		expect(sidebarSource).toContain("return sidebar.isMobile ? 'pt-8' : '';");
		expect(sidebarSource).toContain("import Stack from '$lib/components/primitives/stack.svelte';");
		expect(sidebarSource).not.toContain(
			"import Surface from '$lib/components/primitives/surface.svelte';"
		);
		expect(sidebarSource).toContain(
			'<Stack gap="0" class={`min-h-0 flex-1 ${nativeShellInsetClass}`.trim()}>'
		);
		expect(sidebarSource).toContain('<div class="flex min-h-0 flex-1 flex-col overflow-hidden">');
	});

	it('keeps non-native shell toggle controls inside the sidebar component', () => {
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');
		const railSource = readSource('src/lib/components/app-sidebar-panel-rail.svelte');
		const navUserSource = readSource('src/lib/components/nav-user.svelte');

		expect(sidebarSource).toContain('collapsible="offcanvas"');
		expect(sidebarSource).toContain('<AppSidebarPanelRail />');
		expect(sidebarSource).toContain('<Sidebar.Content>');
		expect(railSource).toContain("label: 'Pages'");
		expect(railSource).toContain("label: 'Projects'");
		expect(navUserSource).toContain("variant = 'sidebar'");
		expect(navUserSource).toContain('aria-label="Open user menu"');
		expect(navUserSource).toContain('variant="ghost"');
	});

	it('uses the panel shell instead of the legacy nav-main and nav-projects composition', () => {
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');

		expect(sidebarSource).not.toContain("import NavMain from './nav-main.svelte';");
		expect(sidebarSource).not.toContain("import NavProjects from './nav-projects.svelte';");
		expect(sidebarSource).not.toContain('<NavMain');
		expect(sidebarSource).not.toContain('<NavProjects');
		expect(sidebarSource).toContain("{#if appState.activeSidebarPanel === 'pages'}");
	});

	it('keeps shell header controls visually aligned with the polished rail states', () => {
		const pagesPanelSource = readSource('src/lib/components/app-sidebar-pages-panel.svelte');
		const projectsPanelSource = readSource('src/lib/components/app-sidebar-projects-panel.svelte');
		const railSource = readSource('src/lib/components/app-sidebar-panel-rail.svelte');

		expect(railSource).toContain('text-sidebar-foreground/70');
		expect(railSource).toContain('hover-surface-sidebar-accent');
		expect(railSource).toContain('hover:text-sidebar-accent-foreground');
		expect(railSource).toContain('ui-radius-tight');
		expect(railSource).toContain("import { projectsState } from '$lib/state/projects.svelte.js';");
		expect(railSource).toContain('const hasExplorerContent = $derived(');
		expect(railSource).toContain('(project.asset_count ?? 0) > 0');
		expect(railSource).toContain(
			"if (!hasExplorerContent && appState.activeSidebarPanel === 'explorer')"
		);
		expect(railSource).not.toContain('hover:shadow-sm');
		expect(pagesPanelSource).toContain('placeholder="Search..."');
		expect(pagesPanelSource).toContain('<Sidebar.MenuAction');
		expect(pagesPanelSource).toContain('Create {destination.title}');
		expect(pagesPanelSource).toContain('appState.hiddenSetupPageIds');
		expect(pagesPanelSource).toContain('dismissMobileSidebar();');
		expect(pagesPanelSource).toContain('<p class="eyebrow px-2">Estimating</p>');
		expect(projectsPanelSource).toContain('placeholder="Search..."');
		expect(projectsPanelSource).toContain(
			'<Sidebar.GroupLabel class="px-2">Favourites</Sidebar.GroupLabel>'
		);
		expect(projectsPanelSource).toContain('splitSidebarProjects(');
		expect(projectsPanelSource).toContain('class="shrink-0 space-y-2 px-2 pb-2"');
		expect(projectsPanelSource).toContain('class={`ui-sidebar-item-radius transition-colors ${');
		expect(projectsPanelSource).toContain(
			'class="!h-auto min-h-12 items-start gap-2.5 px-2.5 py-2"'
		);
		expect(projectsPanelSource).not.toContain(
			"import { Button } from '$lib/components/ui/button/index.js';"
		);
		expect(projectsPanelSource).toContain('<Sidebar.MenuButton onclick={onRequestNewRfq}>');
		expect(projectsPanelSource).not.toContain('border border-sidebar-border/70');
		expect(projectsPanelSource).toContain(
			"import ProjectActionsMenu from '$lib/components/project-actions-menu.svelte';"
		);
		expect(projectsPanelSource).toContain('onAction={dismissMobileSidebar}');
		expect(projectsPanelSource).toContain('onEditRequest={onRequestEditProject}');
		expect(projectsPanelSource).toContain('onDeleteRequest={onRequestDeleteProject}');
		expect(projectsPanelSource).toContain('aria-label="RFQ actions"');
	});

	it('keeps the sidebar footer user menu compact', () => {
		const navUserSource = readSource('src/lib/components/nav-user.svelte');

		expect(navUserSource).toContain('group-data-[collapsible=icon]:hidden');
		expect(navUserSource).toContain('group-data-[collapsible=icon]:size-8');
	});
});
