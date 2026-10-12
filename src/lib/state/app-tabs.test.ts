import { describe, expect, it, vi } from 'vitest';

import {
	AppTabsState,
	buildTabDestination,
	createHomeTabDestination,
	type AppTabDestination
} from './app-tabs.svelte.js';
import { storeService } from '$lib/services/store.js';

const companiesDestination: AppTabDestination = {
	id: 'companies',
	kind: 'page',
	route: '/companies',
	title: 'Companies'
};

describe('appTabsState', () => {
	it('reuses an existing top-level destination instead of duplicating tabs', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();

		state.openOrFocus(companiesDestination);
		state.openOrFocus(createHomeTabDestination());
		state.openOrFocus(companiesDestination);

		expect(state.tabs.map((tab) => tab.id)).toEqual(['rfqs', 'companies']);
		expect(state.activeTabId).toBe('companies');
		expect(state.tabs.find((tab) => tab.id === 'companies')?.route).toBe('/companies');
	});

	it('keeps project subroutes inside the same project tab', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();

		const destination = buildTabDestination({
			pathname: '/project/project-1/quote/pdf',
			projectId: 'project-1',
			projectNumber: 'RFQ-1001'
		});

		expect(destination).not.toBeNull();
		state.openOrFocus(destination!);
		state.syncActiveRoute('/project/project-1/asset/asset-5');

		expect(state.tabs).toHaveLength(2);
		expect(state.activeTabId).toBe('project:project-1');
		expect(state.tabs.find((tab) => tab.id === 'project:project-1')?.route).toBe(
			'/project/project-1/asset/asset-5'
		);
		expect(state.tabs.find((tab) => tab.id === 'project:project-1')?.title).toBe('RFQ-1001');
	});

	it('opens preview routes as dedicated file preview tabs', () => {
		const destination = buildTabDestination({
			pathname: '/preview/file/file-1',
			fileId: 'file-1',
			fileName: 'shop-drawing.pdf'
		});

		expect(destination).toEqual({
			id: 'file-preview:file-1',
			kind: 'file-preview',
			fileId: 'file-1',
			route: '/preview/file/file-1',
			title: 'shop-drawing.pdf'
		});
	});

	it('preserves classification detail routes inside the shared classification tab', () => {
		const destination = buildTabDestination({
			pathname: '/classification-systems/system-1'
		});

		expect(destination).toEqual({
			id: 'classification',
			kind: 'page',
			route: '/classification-systems/system-1',
			title: 'Classification',
			createActionId: 'classification-system',
			searchKeywords: ['classification', 'codes', 'cost code', 'cost codes']
		});
	});

	it('keeps each file preview in its own tab and reuses the same file tab', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();

		state.openOrFocus({
			id: 'file-preview:file-1',
			kind: 'file-preview',
			fileId: 'file-1',
			route: '/preview/file/file-1',
			title: 'drawing-a.pdf'
		});
		state.openOrFocus({
			id: 'file-preview:file-2',
			kind: 'file-preview',
			fileId: 'file-2',
			route: '/preview/file/file-2',
			title: 'drawing-b.pdf'
		});
		state.openOrFocus({
			id: 'file-preview:file-1',
			kind: 'file-preview',
			fileId: 'file-1',
			route: '/preview/file/file-1',
			title: 'drawing-a.pdf'
		});

		expect(state.tabs.map((tab) => tab.id)).toEqual([
			'rfqs',
			'file-preview:file-1',
			'file-preview:file-2'
		]);
		expect(state.activeTabId).toBe('file-preview:file-1');
	});

	it('restores a prior tab session and active tab', () => {
		const state = new AppTabsState();

		state.restore({
			activeTabId: 'project:project-1',
			tabs: [
				createHomeTabDestination(),
				{
					id: 'project:project-1',
					kind: 'project',
					projectId: 'project-1',
					route: '/project/project-1/quote',
					title: 'RFQ-1001'
				}
			]
		});

		expect(state.tabs).toHaveLength(2);
		expect(state.activeTabId).toBe('project:project-1');
		expect(state.activeTab?.route).toBe('/project/project-1/quote');
	});

	it('coalesces concurrent tab hydration into one persisted-snapshot read', async () => {
		const state = new AppTabsState();
		const getSnapshot = vi.spyOn(storeService, 'getAppTabsSnapshot').mockResolvedValue({
			activeTabId: 'rfqs',
			tabs: [createHomeTabDestination()]
		});

		try {
			const [first, second] = await Promise.all([
				state.hydrate(createHomeTabDestination(), '/'),
				state.hydrate(createHomeTabDestination(), '/')
			]);

			expect(first).toBeNull();
			expect(second).toBeNull();
			expect(getSnapshot).toHaveBeenCalledTimes(1);
			expect(state.isHydrated).toBe(true);
		} finally {
			getSnapshot.mockRestore();
		}
	});

	it('restores file preview tabs from a saved snapshot', () => {
		const state = new AppTabsState();

		state.restore({
			activeTabId: 'file-preview:file-1',
			tabs: [
				createHomeTabDestination(),
				{
					id: 'file-preview:file-1',
					kind: 'file-preview',
					fileId: 'file-1',
					route: '/preview/file/file-1',
					title: 'shop-drawing.pdf'
				}
			]
		});

		expect(state.activeTabId).toBe('file-preview:file-1');
		expect(state.activeTab).toMatchObject({
			id: 'file-preview:file-1',
			kind: 'file-preview',
			fileId: 'file-1',
			route: '/preview/file/file-1'
		});
	});

	it('does not rewrite tab state when the active destination is already current', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();
		state.openOrFocus(companiesDestination);

		const tabsAfterOpen = state.tabs;

		state.openOrFocus(companiesDestination);
		expect(state.tabs).toBe(tabsAfterOpen);

		state.syncActiveRoute('/companies');
		expect(state.tabs).toBe(tabsAfterOpen);

		state.setProjectDirty('missing-project', false);
		expect(state.tabs).toBe(tabsAfterOpen);
	});

	it('reorders tabs without changing the active tab', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();
		state.openOrFocus(companiesDestination);

		const materialsDestination = buildTabDestination({
			pathname: '/materials'
		});

		expect(materialsDestination).not.toBeNull();
		state.openOrFocus(materialsDestination!);
		expect(state.activeTabId).toBe('materials');

		state.reorderTabs(['rfqs', 'materials', 'companies']);

		expect(state.tabs.map((tab) => tab.id)).toEqual(['rfqs', 'materials', 'companies']);
		expect(state.activeTabId).toBe('materials');
	});

	it('drops an inactive deleted project tab without changing the active tab', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();
		state.openOrFocus(companiesDestination);
		state.openOrFocus({
			id: 'project:project-1',
			kind: 'project',
			projectId: 'project-1',
			route: '/project/project-1',
			title: 'RFQ-1001'
		});
		state.activate('companies');

		state.handleDeletedProjects(['project-1']);

		expect(state.tabs.map((tab) => tab.id)).toEqual(['rfqs', 'companies']);
		expect(state.activeTabId).toBe('companies');
		expect(state.consumePendingNavigationRoute()).toBeNull();
	});

	it('does not build a destination for removed legacy contacts routes', () => {
		expect(
			buildTabDestination({
				pathname: '/contacts'
			})
		).toBeNull();
		expect(
			buildTabDestination({
				pathname: '/customers'
			})
		).toBeNull();
	});

	it('falls back to the next surviving tab when the active deleted project tab is removed', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();
		state.openOrFocus({
			id: 'project:project-1',
			kind: 'project',
			projectId: 'project-1',
			route: '/project/project-1/quote',
			title: 'RFQ-1001'
		});
		state.openOrFocus({
			id: 'project:project-2',
			kind: 'project',
			projectId: 'project-2',
			route: '/project/project-2',
			title: 'RFQ-1002'
		});
		state.activate('project:project-1');

		state.handleDeletedProjects(['project-1']);

		expect(state.tabs.map((tab) => tab.id)).toEqual(['rfqs', 'project:project-2']);
		expect(state.activeTabId).toBe('project:project-2');
		expect(state.consumePendingNavigationRoute()).toBe('/project/project-2');
		expect(state.consumePendingNavigationRoute()).toBeNull();
	});

	it('falls back to the nearest surviving tab when bulk delete removes the active project and its right neighbour', () => {
		const state = new AppTabsState();
		state.ensureDefaultTab();
		state.openOrFocus(companiesDestination);
		state.openOrFocus({
			id: 'project:project-1',
			kind: 'project',
			projectId: 'project-1',
			route: '/project/project-1',
			title: 'RFQ-1001'
		});
		state.openOrFocus({
			id: 'project:project-2',
			kind: 'project',
			projectId: 'project-2',
			route: '/project/project-2',
			title: 'RFQ-1002'
		});
		state.activate('project:project-1');

		state.handleDeletedProjects(['project-1', 'project-2']);

		expect(state.tabs.map((tab) => tab.id)).toEqual(['rfqs', 'companies']);
		expect(state.activeTabId).toBe('companies');
		expect(state.consumePendingNavigationRoute()).toBe('/companies');
	});
});
