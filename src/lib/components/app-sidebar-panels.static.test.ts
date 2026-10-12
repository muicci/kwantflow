import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('app sidebar panel shell', () => {
	it('uses the new pages and projects panel composition', () => {
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');

		expect(sidebarSource).toContain(
			"import AppSidebarPanelRail from './app-sidebar-panel-rail.svelte';"
		);
		expect(sidebarSource).toContain(
			"import AppSidebarPagesPanel from './app-sidebar-pages-panel.svelte';"
		);
		expect(sidebarSource).toContain(
			"import AppSidebarProjectsPanel from './app-sidebar-projects-panel.svelte';"
		);
		expect(sidebarSource).not.toContain("import NavMain from './nav-main.svelte';");
		expect(sidebarSource).not.toContain("import NavProjects from './nav-projects.svelte';");
		expect(sidebarSource).toContain('<AppSidebarPanelRail');
		expect(sidebarSource).toContain("{#if appState.activeSidebarPanel === 'pages'}");
		expect(sidebarSource).toContain('<AppSidebarPagesPanel');
		expect(sidebarSource).toContain('{dismissMobileSidebar}');
		expect(sidebarSource).toContain('onRequestQuickCreate={(actionId) => {');
		expect(sidebarSource).toContain('<AppSidebarProjectsPanel');
		expect(sidebarSource).toContain('onRequestNewRfq={() => {');
		expect(sidebarSource).toContain('onRequestEditProject={(project) => {');
		expect(sidebarSource).toContain('onRequestDeleteProject={(project) => {');
	});
});
