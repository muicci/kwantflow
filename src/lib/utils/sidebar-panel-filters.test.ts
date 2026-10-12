import { describe, expect, it } from 'vitest';
import {
	filterSidebarPageDestinations,
	splitSidebarProjects,
	isSidebarPanelId
} from './sidebar-panel-filters.js';
import { ProjectStatus } from '$lib/constants/index.js';
import { APP_SHELL_PAGE_DESTINATIONS } from '$lib/state/app-tabs.svelte.js';
import { OPTIONAL_SETUP_PAGE_IDS } from '$lib/constants/setup-page-visibility.js';
import type { Project } from '$lib/types/index.js';

function createProject(
	overrides: Partial<
		Pick<
			Project,
			| 'id'
			| 'rfq_number'
			| 'contact_name'
			| 'requester_contact_name'
			| 'project_name'
			| 'is_favourite'
		>
	>
): Project {
	return {
		id: overrides.id ?? 'project-1',
		workspace_id: 'workspace-1',
		sort_order: 0,
		is_favourite: overrides.is_favourite ?? false,
		rfq_number: overrides.rfq_number ?? 'RFQ-1001',
		created_at: '2026-03-24T00:00:00.000Z',
		updated_at: '2026-03-24T00:00:00.000Z',
		status: ProjectStatus.Draft,
		due_date: undefined,
		content: undefined,
		note: undefined,
		contact_id: null,
		contact_name_snapshot: null,
		project_name: overrides.project_name,
		contact_name: overrides.contact_name ?? null,
		requester_contact_name: overrides.requester_contact_name ?? null,
		priority: undefined,
		asset_count: undefined
	};
}

describe('filterSidebarPageDestinations', () => {
	it('keeps RFQs and Companies in the primary section and estimating pages below the divider', () => {
		const result = filterSidebarPageDestinations('');
		const expectedPrimaryIds = APP_SHELL_PAGE_DESTINATIONS.filter((item) =>
			['rfqs', 'companies'].includes(item.id)
		).map((item) => item.id);
		const expectedEstimatingIds = APP_SHELL_PAGE_DESTINATIONS.filter(
			(item) => !['rfqs', 'companies'].includes(item.id)
		).map((item) => item.id);

		expect(result.primary.map((item) => item.id)).toEqual(expectedPrimaryIds);
		expect(result.estimating.map((item) => item.id)).toEqual(expectedEstimatingIds);
	});

	it('filters page destinations by title within the active panel', () => {
		const result = filterSidebarPageDestinations('rate');
		const expectedRateTitles = APP_SHELL_PAGE_DESTINATIONS.filter((item) =>
			item.title.toLowerCase().includes('rate')
		).map((item) => item.title);

		expect(result.primary).toEqual([]);
		expect(result.estimating.map((item) => item.title)).toEqual(expectedRateTitles);
	});

	it('matches page destinations by deliberate search keywords as well as title', () => {
		const contactsResult = filterSidebarPageDestinations('client');
		const classificationResult = filterSidebarPageDestinations('cost code');

		expect(contactsResult.primary.map((item) => item.id)).toEqual(['companies']);
		expect(classificationResult.estimating.map((item) => item.id)).toEqual(['classification']);
	});

	it('hides only optional setup pages from the sidebar results when requested', () => {
		const result = filterSidebarPageDestinations('', ['materials', 'estimate-templates']);

		expect(result.primary.map((item) => item.id)).toEqual(['rfqs', 'companies']);
		expect(result.estimating.some((item) => item.id === 'materials')).toBe(false);
		expect(result.estimating.some((item) => item.id === 'estimate-templates')).toBe(false);
		expect(result.estimating.some((item) => item.id === 'classification')).toBe(true);
		expect(OPTIONAL_SETUP_PAGE_IDS.includes('materials')).toBe(true);
	});
});

describe('splitSidebarProjects', () => {
	const projects = [
		createProject({
			id: 'project-1',
			rfq_number: 'RFQ-1001',
			contact_name: 'Atlas Steel',
			requester_contact_name: 'Harry Potter',
			project_name: 'Atlas Main Frame',
			is_favourite: true
		}),
		createProject({
			id: 'project-2',
			rfq_number: 'RFQ-1002',
			contact_name: 'Bluebird Fabrication',
			requester_contact_name: 'Sally Brown',
			project_name: 'Bluebird Walkway',
			is_favourite: false
		}),
		createProject({
			id: 'project-3',
			rfq_number: 'RFQ-1003',
			contact_name: null,
			project_name: 'Gamma Fitout',
			is_favourite: true
		})
	];

	it('deduplicates recent items that are already shown in favourites', () => {
		const result = splitSidebarProjects(projects, [projects[0], projects[1], projects[2]], '');

		expect(result.favourites.map((project) => project.id)).toEqual(['project-1', 'project-3']);
		expect(result.recent.map((project) => project.id)).toEqual(['project-2']);
	});

	it('matches projects by RFQ number, contact name, and project name', () => {
		expect(
			splitSidebarProjects(projects, projects, '1002').recent.map((project) => project.id)
		).toEqual(['project-2']);
		expect(
			splitSidebarProjects(projects, projects, 'atlas').favourites.map((project) => project.id)
		).toEqual(['project-1']);
		expect(
			splitSidebarProjects(projects, projects, 'gamma').favourites.map((project) => project.id)
		).toEqual(['project-3']);
		expect(
			splitSidebarProjects(projects, projects, 'sally').recent.map((project) => project.id)
		).toEqual(['project-2']);
	});
});

describe('isSidebarPanelId', () => {
	it('returns true for valid sidebar panel ids', () => {
		expect(isSidebarPanelId('pages')).toBe(true);
		expect(isSidebarPanelId('projects')).toBe(true);
		expect(isSidebarPanelId('explorer')).toBe(true);
	});

	it('returns false for invalid sidebar panel ids', () => {
		expect(isSidebarPanelId('')).toBe(false);
		expect(isSidebarPanelId('foo')).toBe(false);
		expect(isSidebarPanelId('page')).toBe(false);
		expect(isSidebarPanelId('project')).toBe(false);
	});
});
