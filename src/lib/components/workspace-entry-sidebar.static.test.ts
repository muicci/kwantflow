import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(path: string) {
	return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('workspace entry sidebar smoothing', () => {
	it('collapses the sidebar before opening a workspace from the project actions menu', () => {
		const source = readSource('src/lib/components/project-actions-menu.svelte');

		expect(source).toContain('appState.prepareForWorkspaceEntry();');
		expect(source.indexOf('appState.prepareForWorkspaceEntry();')).toBeLessThan(
			source.indexOf('goto(resolve(`/project/${project.id}` as AppHref));')
		);
	});

	it('shows a create-first empty state and recent RFQ list behaviour in the RFQ section', () => {
		const source = readSource('src/lib/components/app-sidebar-projects-panel.svelte');

		expect(source).toContain('const projectSections = $derived(');
		expect(source).toContain('splitSidebarProjects(');
		expect(source).toContain('placeholder="Search..."');
		expect(source).toContain('New RFQ');
		expect(source).toContain('{#if projectSections.favourites.length > 0}');
		expect(source).toContain('{#if projectSections.recent.length > 0}');
		expect(source).toContain('{#each projectSections.recent as project (project.id)}');
		expect(source).toContain('<Text as="span" class="truncate">{project.rfq_number}</Text>');
		expect(source).toContain('isProjectRouteActive(project.id)');
		expect(source).toContain('dismissMobileSidebar();');
		expect(source).toContain('appState.prepareForWorkspaceEntry();');
		expect(source).toContain('href={resolve(`/project/${project.id}`)}');
		expect(source).toContain('<Sidebar.GroupLabel class="px-2">Favourites</Sidebar.GroupLabel>');
		expect(source).toContain('onAction={dismissMobileSidebar}');
		expect(source).toContain('aria-label="RFQ actions"');
	});
});
