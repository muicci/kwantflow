import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbServiceMock = {
	getWorkspaceShell: vi.fn(),
	getAssetsForProject: vi.fn(),
	getProjectFiles: vi.fn(),
	createAssetFromFiles: vi.fn(),
	assignFilesToAsset: vi.fn()
};

const explorerStateMock = {
	refreshProjectBranch: vi.fn(),
	syncProjects: vi.fn()
};

const storeServiceMock = {
	getActiveProjectId: vi.fn(),
	setActiveProjectId: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const contactsStateMock = {
	list: [],
	companyContacts: [],
	getLinkedPeople: vi.fn(() => []),
	refresh: vi.fn()
};

const toastMock = {
	success: vi.fn(),
	warning: vi.fn()
};

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('../services/store', () => ({
	storeService: storeServiceMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('./contacts.svelte', () => ({
	contactsState: contactsStateMock
}));

vi.mock('./explorer.svelte.js', () => ({
	explorerState: explorerStateMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('../utils/env', () => ({
	isTauri: () => false,
	hasInternetConnection: () => true
}));

vi.mock('$lib/services/assets.js', () => ({
	removeDerivedPreviewCacheForSource: vi.fn(),
	removeVaultFile: vi.fn()
}));

vi.mock('$lib/utils/manual-order.js', () => ({
	buildMergedManualOrderIds: vi.fn((_, visibleOrderedIds: string[]) => visibleOrderedIds)
}));

vi.mock('$lib/utils/project-contact.js', () => ({
	resolveProjectContactLink: vi.fn(),
	resolveProjectRequesterLink: vi.fn(),
	normaliseContactName: vi.fn((value: string) => value.trim().toLowerCase())
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

describe('projectsState workspace shell', () => {
	beforeEach(async () => {
		vi.resetAllMocks();
		dbServiceMock.getWorkspaceShell.mockResolvedValue({
			project: {
				id: 'project-1',
				owner_user_id: 'owner-1',
				sort_order: 0,
				is_favourite: false,
				rfq_number: 'RFQ-1001',
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z',
				status: 'Draft',
				contact_name: 'Acme'
			},
			assets: [
				{
					id: 'asset-1',
					project_id: 'project-1',
					display_name: 'Asset One',
					thumbnail_file_id: null,
					is_selected: true,
					created_at: '2026-03-09T00:00:00.000Z',
					files: []
				}
			],
			unassignedFiles: [
				{
					id: 'file-1',
					project_id: 'project-1',
					asset_id: null,
					file_path: 'workspace/project-1/file-1.pdf',
					original_name: 'file-1.pdf',
					mime_type: 'application/pdf',
					created_at: '2026-03-09T00:00:00.000Z'
				}
			]
		});
		dbServiceMock.getAssetsForProject.mockResolvedValue([
			{
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Asset One',
				thumbnail_file_id: null,
				is_selected: true,
				created_at: '2026-03-09T00:00:00.000Z',
				files: []
			}
		]);
		dbServiceMock.getProjectFiles.mockResolvedValue([
			{
				id: 'file-1',
				project_id: 'project-1',
				asset_id: null,
				file_path: 'workspace/project-1/file-1.pdf',
				original_name: 'file-1.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		const { projectsState } = await import('./projects.svelte');
		projectsState.clearWorkspaceShell();
	});

	it('refreshes the shared workspace snapshot from the DB authority', async () => {
		const { projectsState } = await import('./projects.svelte');

		const shell = await projectsState.refreshWorkspaceShell('project-1');

		expect(dbServiceMock.getWorkspaceShell).toHaveBeenCalledWith('project-1');
		expect(explorerStateMock.refreshProjectBranch).toHaveBeenCalledWith('project-1');
		expect(shell.project.id).toBe('project-1');
		expect(projectsState.workspaceProject?.id).toBe('project-1');
		expect(projectsState.workspaceAssets.map((asset) => asset.id)).toEqual(['asset-1']);
		expect(projectsState.workspaceUnassignedFiles.map((file) => file.id)).toEqual(['file-1']);
	});

	it('clears the shared workspace snapshot when asked', async () => {
		const { projectsState } = await import('./projects.svelte');

		await projectsState.refreshWorkspaceShell('project-1');
		projectsState.clearWorkspaceShell();

		expect(projectsState.workspaceProject).toBeNull();
		expect(projectsState.workspaceAssets).toEqual([]);
		expect(projectsState.workspaceUnassignedFiles).toEqual([]);
	});

	it('reconciles the active workspace asset/file collections after asset grouping without reloading the full shell', async () => {
		const { projectsState } = await import('./projects.svelte');

		await projectsState.refreshWorkspaceShell('project-1');
		dbServiceMock.getAssetsForProject.mockResolvedValueOnce([
			{
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Grouped Asset',
				thumbnail_file_id: null,
				is_selected: true,
				created_at: '2026-03-09T00:00:00.000Z',
				files: [
					{
						id: 'file-1',
						project_id: 'project-1',
						asset_id: 'asset-1',
						file_path: 'workspace/project-1/file-1.pdf',
						original_name: 'file-1.pdf',
						mime_type: 'application/pdf',
						created_at: '2026-03-09T00:00:00.000Z'
					}
				]
			}
		]);
		dbServiceMock.getProjectFiles.mockResolvedValueOnce([
			{
				id: 'file-1',
				project_id: 'project-1',
				asset_id: 'asset-1',
				file_path: 'workspace/project-1/file-1.pdf',
				original_name: 'file-1.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);
		dbServiceMock.getProjectFiles.mockResolvedValueOnce([
			{
				id: 'file-1',
				project_id: 'project-1',
				asset_id: 'asset-1',
				file_path: 'workspace/project-1/file-1.pdf',
				original_name: 'file-1.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		await projectsState.createAssetFromFiles('project-1', ['file-1'], 'Grouped Asset');
		await Promise.resolve();

		expect(dbServiceMock.createAssetFromFiles).toHaveBeenCalledWith(
			expect.any(String),
			'project-1',
			'Grouped Asset',
			['file-1']
		);
		expect(dbServiceMock.getAssetsForProject).toHaveBeenCalledWith('project-1');
		expect(dbServiceMock.getProjectFiles).toHaveBeenCalledWith('project-1');
		expect(dbServiceMock.getWorkspaceShell).toHaveBeenCalledTimes(1);
		expect(projectsState.workspaceAssets[0]?.display_name).toBe('Grouped Asset');
		expect(projectsState.workspaceUnassignedFiles).toEqual([]);
	});

	it('reconciles the workspace after adding files to an existing asset', async () => {
		const { projectsState } = await import('./projects.svelte');

		await projectsState.refreshWorkspaceShell('project-1');
		dbServiceMock.getAssetsForProject.mockResolvedValueOnce([
			{
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Asset One',
				thumbnail_file_id: null,
				is_selected: true,
				created_at: '2026-03-09T00:00:00.000Z',
				files: [
					{
						id: 'file-1',
						project_id: 'project-1',
						asset_id: 'asset-1',
						file_path: 'workspace/project-1/file-1.pdf',
						original_name: 'file-1.pdf',
						mime_type: 'application/pdf',
						created_at: '2026-03-09T00:00:00.000Z'
					}
				]
			}
		]);
		dbServiceMock.getProjectFiles.mockResolvedValueOnce([
			{
				id: 'file-1',
				project_id: 'project-1',
				asset_id: 'asset-1',
				file_path: 'workspace/project-1/file-1.pdf',
				original_name: 'file-1.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);
		dbServiceMock.getProjectFiles.mockResolvedValueOnce([
			{
				id: 'file-1',
				project_id: 'project-1',
				asset_id: 'asset-1',
				file_path: 'workspace/project-1/file-1.pdf',
				original_name: 'file-1.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		await projectsState.addFilesToAsset('project-1', 'asset-1', ['file-1']);
		await Promise.resolve();

		expect(dbServiceMock.assignFilesToAsset).toHaveBeenCalledWith('asset-1', 'project-1', [
			'file-1'
		]);
	});
});
