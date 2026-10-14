import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('sidebar panel rail', () => {
	it('keeps the panel rail explicit and closes the sidebar from the panel itself', () => {
		const source = readSource('src/lib/components/app-sidebar-panel-rail.svelte');

		expect(source).toContain('const sidebar = Sidebar.useSidebar();');
		expect(source).toContain('aria-pressed={appState.activeSidebarPanel === option.id');
		const sidebarTypesSource = readSource('src/lib/components/ui/sidebar/types.ts');
		expect(sidebarTypesSource).toContain('transition-[width,height,padding]');
		expect(sidebarTypesSource).toContain('hover-surface-sidebar-accent');
		expect(sidebarTypesSource).toContain('shell-nav-copy');
		expect(sidebarTypesSource).toContain('ui-shell-nav-row');
		expect(sidebarTypesSource).not.toContain('hover:shadow-sm');
		expect(sidebarTypesSource).not.toContain('data-[active=true]:shadow-sm');
		expect(sidebarTypesSource).toContain('group-data-[collapsible=icon]:size-9!');
		expect(sidebarTypesSource).toContain('group-data-[collapsible=icon]:p-2!');
		expect(sidebarTypesSource).toContain('[&>span:last-child]:truncate');
	});
});
