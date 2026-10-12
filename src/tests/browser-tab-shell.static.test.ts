import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('browser-style tab shell', () => {
	it('removes native window tab and native accessory control paths', () => {
		const tauriLib = readSource('src-tauri/src/lib.rs');
		const layoutSource = readSource('src/routes/+layout.svelte');
		const projectsPanelSource = readSource('src/lib/components/app-sidebar-projects-panel.svelte');
		const projectActionsSource = readSource('src/lib/components/project-actions-menu.svelte');

		expect(tauriLib).not.toContain('const NATIVE_SIDEBAR_TOGGLE_EVENT');
		expect(tauriLib).not.toContain('const NATIVE_USER_MENU_TOGGLE_EVENT');
		expect(tauriLib).not.toContain('const NATIVE_SHELL_OPEN_ROUTE_EVENT');
		expect(tauriLib).not.toContain('NSTitlebarAccessoryViewController');
		expect(tauriLib).not.toContain('tabbing_identifier');
		expect(tauriLib).not.toContain('open_workspace_tab');
		expect(tauriLib).not.toContain('configure_main_window_surface');
		expect(layoutSource).toContain(
			"import AppShellTabStrip from '$lib/components/app-shell-tab-strip.svelte';"
		);
		expect(layoutSource).toContain('appTabsState,');
		expect(layoutSource).toContain("import { resolve } from '$app/paths';");
		expect(layoutSource).toContain(
			"import type { AppShellHref } from '$lib/utils/app-shell-href.js';"
		);
		expect(layoutSource).not.toContain('NativeShellSidebarToggleBridge');
		expect(layoutSource).not.toContain('nativeTrigger');
		expect(layoutSource).not.toContain('window.__KWANTFLOW_INITIAL_ROUTE__');
		expect(layoutSource).not.toContain('listen<string>(NATIVE_SHELL_OPEN_ROUTE_EVENT');
		expect(projectsPanelSource).not.toContain('openWorkspaceInNativeTab');
		expect(projectActionsSource).not.toContain('openWorkspaceInNativeTab');
	});

	it('uses width-aware tab windowing instead of a fixed first-six slice', () => {
		const tabStripSource = readSource('src/lib/components/app-shell-tab-strip.svelte');
		const layoutHelperSource = readSource('src/lib/components/app-shell-tab-strip.layout.ts');
		const appTabsSource = readSource('src/lib/state/app-tabs.svelte.ts');
		const projectsStateSource = readSource('src/lib/state/projects.svelte.ts');
		const layoutSource = readSource('src/routes/+layout.svelte');

		expect(tabStripSource).toContain('computeTabStripLayout');
		expect(tabStripSource).toContain('bind:offsetWidth={tabRailWidth}');
		expect(tabStripSource).toContain('APP_SHELL_PAGE_DESTINATIONS');
		expect(tabStripSource).toContain('chrome-tab-scroll');
		expect(tabStripSource).toContain("import { DragDropProvider } from '@dnd-kit-svelte/svelte';");
		expect(tabStripSource).toContain('RestrictToHorizontalAxis');
		expect(tabStripSource).toContain('{ ref, isDragging, handleRef } = useSortable');
		expect(tabStripSource).toContain('appTabsState.reorderTabs(nextOrderedIds);');
		expect(tabStripSource).not.toContain('buildTabDestination(');
		expect(tabStripSource).not.toContain('appTabsState.openOrFocus(currentDestination);');
		expect(tabStripSource).not.toContain('appTabsState.syncActiveRoute(pathname);');
		expect(tabStripSource).not.toContain('tabs.length > 6 ? tabs.slice(6) : []');
		expect(tabStripSource).not.toContain('tabs.length > 6 ? tabs.slice(0, 6) : tabs');
		expect(layoutHelperSource).toContain('MAX_VISIBLE_TABS = 10');
		expect(layoutHelperSource).toContain('MIN_TAB_WIDTH_PX = 128');
		expect(appTabsSource).toContain('export const APP_SHELL_PAGE_DESTINATIONS = [');
		expect(appTabsSource).toContain("reorderTabs(orderedIds: AppTabRecord['id'][]): void {");
		expect(appTabsSource).toContain('handleDeletedProjects(projectIds: string[]): void {');
		expect(appTabsSource).toContain('consumePendingNavigationRoute(): AppShellHref | null {');
		expect(projectsStateSource).toContain('appTabsState.handleDeletedProjects([id]);');
		expect(projectsStateSource).toContain('appTabsState.handleDeletedProjects(ids);');
		expect(layoutSource).toContain(
			'const nextRoute = appTabsState.consumePendingNavigationRoute();'
		);
		expect(layoutSource).toContain('isWorkspaceRoute && !headerProject?.id');
	});
});
