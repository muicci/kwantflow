import { describe, expect, it } from 'vitest';
import type { Asset, AssetFile, Project } from '$lib/types/index.js';
import { ProjectStatus } from '$lib/constants/index.js';
import { buildExplorerVisibleProjects } from './app-sidebar-explorer-panel.helpers.js';

const makeProject = (overrides: Partial<Project> = {}): Project => ({
	id: overrides.id ?? 'project-1',
	workspace_id: overrides.workspace_id ?? 'workspace-1',
	sort_order: overrides.sort_order ?? 1,
	is_favourite: overrides.is_favourite ?? false,
	rfq_number: overrides.rfq_number ?? 'RFQ-1001',
	created_at: overrides.created_at ?? '2026-03-25T00:00:00.000Z',
	updated_at: overrides.updated_at ?? '2026-03-25T00:00:00.000Z',
	status: overrides.status ?? ProjectStatus.Draft,
	contact_name: overrides.contact_name ?? 'Acme Steel',
	requester_contact_name: overrides.requester_contact_name ?? 'Harry Potter',
	project_name: overrides.project_name ?? 'Factory mezzanine',
	...overrides
});

const makeFile = (overrides: Partial<AssetFile> = {}): AssetFile => ({
	id: overrides.id ?? 'file-1',
	project_id: overrides.project_id ?? 'project-1',
	asset_id: overrides.asset_id ?? null,
	file_path: overrides.file_path ?? 'project-1/spec-sheet.pdf',
	original_name: overrides.original_name ?? 'spec-sheet.pdf',
	mime_type: overrides.mime_type ?? 'application/pdf',
	created_at: overrides.created_at ?? '2026-03-25T00:00:00.000Z',
	...overrides
});

const makeAsset = (overrides: Partial<Asset> = {}): Asset => ({
	id: overrides.id ?? 'asset-1',
	project_id: overrides.project_id ?? 'project-1',
	display_name: overrides.display_name ?? 'Structural set',
	thumbnail_file_id: overrides.thumbnail_file_id ?? null,
	is_selected: overrides.is_selected ?? false,
	created_at: overrides.created_at ?? '2026-03-25T00:00:00.000Z',
	files: overrides.files ?? [],
	...overrides
});

describe('buildExplorerVisibleProjects', () => {
	it('returns all projects when the query is empty', () => {
		const projects = [
			makeProject({ id: 'project-1', rfq_number: 'RFQ-1001' }),
			makeProject({ id: 'project-2', rfq_number: 'RFQ-1002' })
		];

		const result = buildExplorerVisibleProjects(projects, {}, '');

		expect(result.map((entry) => entry.project.id)).toEqual(['project-1', 'project-2']);
		expect(result.every((entry) => entry.matchesSearch === false)).toBe(true);
	});

	it('keeps the matching tree path for a file-name match', () => {
		const project = makeProject({ id: 'project-1', rfq_number: 'RFQ-2001' });
		const matchingFile = makeFile({
			id: 'file-target',
			project_id: project.id,
			asset_id: 'asset-1',
			original_name: 'gearbox-photo.jpg'
		});
		const nonMatchingFile = makeFile({
			id: 'file-other',
			project_id: project.id,
			asset_id: 'asset-1',
			original_name: 'overview.pdf'
		});
		const asset = makeAsset({
			id: 'asset-1',
			project_id: project.id,
			display_name: 'Drive package',
			files: [matchingFile, nonMatchingFile]
		});

		const result = buildExplorerVisibleProjects(
			[project],
			{
				[project.id]: {
					loaded: true,
					assets: [asset],
					unassignedFiles: []
				}
			},
			'gearbox'
		);

		expect(result).toHaveLength(1);
		expect(result[0].project.id).toBe(project.id);
		expect(result[0].matchesSearch).toBe(true);
		expect(result[0].assets).toHaveLength(1);
		expect(result[0].assets[0].asset.id).toBe(asset.id);
		expect(result[0].assets[0].files.map((file) => file.id)).toEqual(['file-target']);
	});

	it('keeps the full branch when the asset name matches', () => {
		const project = makeProject({ id: 'project-1' });
		const asset = makeAsset({
			id: 'asset-1',
			project_id: project.id,
			display_name: 'Electrical drawings',
			files: [
				makeFile({ id: 'file-1', project_id: project.id, asset_id: 'asset-1' }),
				makeFile({
					id: 'file-2',
					project_id: project.id,
					asset_id: 'asset-1',
					original_name: 'panel-schedule.xlsx'
				})
			]
		});

		const result = buildExplorerVisibleProjects(
			[project],
			{
				[project.id]: {
					loaded: true,
					assets: [asset],
					unassignedFiles: []
				}
			},
			'electrical'
		);

		expect(result).toHaveLength(1);
		expect(result[0].assets).toHaveLength(1);
		expect(result[0].assets[0].files.map((file) => file.id)).toEqual(['file-1', 'file-2']);
	});

	it('matches projects by RFQ or project/contact label without loaded children', () => {
		const project = makeProject({
			id: 'project-1',
			rfq_number: 'RFQ-3001',
			project_name: 'Warehouse extension'
		});

		const result = buildExplorerVisibleProjects([project], {}, 'warehouse');

		expect(result).toHaveLength(1);
		expect(result[0].project.id).toBe(project.id);
		expect(result[0].assets).toEqual([]);
		expect(result[0].unassignedFiles).toEqual([]);
	});

	it('matches projects by requester name as secondary RFQ metadata', () => {
		const project = makeProject({
			id: 'project-2',
			rfq_number: 'RFQ-3002',
			contact_name: 'Atlas Steel',
			requester_contact_name: 'Sally Brown'
		});

		const result = buildExplorerVisibleProjects([project], {}, 'sally');

		expect(result).toHaveLength(1);
		expect(result[0].project.id).toBe(project.id);
	});

	it('keeps archived projects visible when the query is empty', () => {
		const archivedProject = makeProject({
			id: 'project-archive',
			rfq_number: 'RFQ-9001',
			status: ProjectStatus.Archived
		});

		const result = buildExplorerVisibleProjects([archivedProject], {}, '');

		expect(result).toHaveLength(1);
		expect(result[0].project.status).toBe(ProjectStatus.Archived);
	});
});
