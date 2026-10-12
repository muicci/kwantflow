import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, AssetFile, Project } from '$lib/types/index.js';
import { ProjectStatus } from '$lib/constants/index.js';

const dbServiceMock = {
	getExplorerProjectSummaries: vi.fn(),
	getExplorerProjectBranch: vi.fn(),
	getExplorerPreviewFile: vi.fn()
};

vi.mock('$lib/services/db.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/db.js')>();
	return {
		...actual,
		dbService: dbServiceMock
	};
});

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
	project_name: overrides.project_name ?? 'Factory mezzanine',
	...overrides
});

const makeFile = (overrides: Partial<AssetFile> = {}): AssetFile => ({
	id: overrides.id ?? 'file-1',
	project_id: overrides.project_id ?? 'project-1',
	asset_id: overrides.asset_id ?? null,
	file_path: overrides.file_path ?? 'workspace/project-1/spec-sheet.pdf',
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

describe('explorerState', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		dbServiceMock.getExplorerProjectSummaries.mockResolvedValue([
			makeProject({ id: 'project-1', rfq_number: 'RFQ-1001' }),
			makeProject({ id: 'project-2', rfq_number: 'RFQ-1002' })
		]);
		dbServiceMock.getExplorerProjectBranch.mockResolvedValue({
			loaded: true,
			assets: [
				makeAsset({
					id: 'asset-1',
					project_id: 'project-1',
					files: [makeFile({ id: 'file-asset-1', asset_id: 'asset-1' })]
				})
			],
			unassignedFiles: [makeFile({ id: 'file-loose-1', asset_id: null })]
		});
	});

	it('hydrates project summaries once and keeps them in state', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.ensureHydrated();
		await explorerState.ensureHydrated();

		expect(dbServiceMock.getExplorerProjectSummaries).toHaveBeenCalledTimes(1);
		expect(explorerState.projects.map((project) => project.id)).toEqual(['project-1', 'project-2']);
	}, 30_000);

	it('loads a project branch lazily and reuses the cached branch', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.loadProjectBranch('project-1');
		await explorerState.loadProjectBranch('project-1');

		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenCalledTimes(1);
		expect(explorerState.projectChildren['project-1']).toMatchObject({
			loaded: true,
			unassignedFiles: [expect.objectContaining({ id: 'file-loose-1' })]
		});
	});

	it('loads all missing branches once when search needs the full tree', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.ensureHydrated();
		await explorerState.prepareSearchTree('drawing');

		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenCalledTimes(2);
		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenNthCalledWith(1, 'project-1');
		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenNthCalledWith(2, 'project-2');
	});

	it('keeps the cached branches when search is cleared', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.loadProjectBranch('project-1');
		await explorerState.prepareSearchTree('drawing');
		await explorerState.prepareSearchTree('');

		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenCalledTimes(2);
		expect(explorerState.projectChildren['project-1']).toMatchObject({
			loaded: true,
			unassignedFiles: [expect.objectContaining({ id: 'file-loose-1' })]
		});
	});

	it('syncs hydrated projects locally and prunes removed branches', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.ensureHydrated();
		await explorerState.loadProjectBranch('project-1');
		explorerState.syncProjects([makeProject({ id: 'project-2', rfq_number: 'RFQ-1002' })]);

		expect(explorerState.projects.map((project) => project.id)).toEqual(['project-2']);
		expect(explorerState.projectChildren['project-1']).toBeUndefined();
	});

	it('refreshes a loaded branch after mutations', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.loadProjectBranch('project-1');
		dbServiceMock.getExplorerProjectBranch.mockResolvedValueOnce({
			loaded: true,
			assets: [],
			unassignedFiles: [makeFile({ id: 'file-loose-2', asset_id: null })]
		});

		await explorerState.refreshProjectBranch('project-1');

		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenCalledTimes(2);
		expect(explorerState.projectChildren['project-1']).toMatchObject({
			loaded: true,
			unassignedFiles: [expect.objectContaining({ id: 'file-loose-2' })]
		});
	});

	it('loads a new branch after the full tree has been prepared', async () => {
		const { explorerState } = await import('./explorer.svelte.js');

		await explorerState.ensureHydrated();
		await explorerState.prepareSearchTree('drawing');
		explorerState.syncProjects([
			makeProject({ id: 'project-1', rfq_number: 'RFQ-1001' }),
			makeProject({ id: 'project-2', rfq_number: 'RFQ-1002' }),
			makeProject({ id: 'project-3', rfq_number: 'RFQ-1003' })
		]);
		dbServiceMock.getExplorerProjectBranch.mockResolvedValueOnce({
			loaded: true,
			assets: [],
			unassignedFiles: [makeFile({ id: 'file-loose-3', project_id: 'project-3', asset_id: null })]
		});

		await explorerState.refreshProjectBranch('project-3');

		expect(dbServiceMock.getExplorerProjectBranch).toHaveBeenCalledTimes(3);
		expect(explorerState.projectChildren['project-3']).toMatchObject({
			loaded: true,
			unassignedFiles: [expect.objectContaining({ id: 'file-loose-3' })]
		});
	});
});
