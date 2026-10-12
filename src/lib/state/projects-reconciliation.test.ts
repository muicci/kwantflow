import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStatus } from '../constants/index.js';

const dbServiceMock = {
	getDatabasePath: vi.fn(),
	createProjectWorkspace: vi.fn(),
	updateProject: vi.fn(),
	updateProjectWorkspace: vi.fn(),
	setProjectFavourite: vi.fn(),
	deleteProject: vi.fn(),
	duplicateProject: vi.fn(),
	deleteContact: vi.fn(),
	getProjectById: vi.fn(),
	getProjects: vi.fn(),
	reorderProjects: vi.fn(),
	addProjectFile: vi.fn(),
	getProjectFiles: vi.fn(),
	findContactByName: vi.fn()
};

const storeServiceMock = {
	getActiveProjectId: vi.fn(),
	setActiveProjectId: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const explorerStateMock = {
	syncProjects: vi.fn(),
	refreshProjectBranch: vi.fn(),
	removeProjects: vi.fn()
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

const resolveProjectContactLinkMock = vi.fn();
const resolveProjectRequesterLinkMock = vi.fn();
const removeDerivedPreviewCacheForSourceMock = vi.fn();
const removeVaultFileMock = vi.fn();
const readVaultFileMock = vi.fn();
const hashFileBytesMock = vi.fn();
const isTauriMock = vi.fn(() => false);
const invokeMock = vi.fn();

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('../services/store', () => ({
	storeService: storeServiceMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('./explorer.svelte.js', () => ({
	explorerState: explorerStateMock
}));

vi.mock('./contacts.svelte', () => ({
	contactsState: contactsStateMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('../utils/env', () => ({
	isTauri: isTauriMock,
	hasInternetConnection: () => true
}));

const removePreparedEvidenceCacheForSourceMock = vi.fn();

vi.mock('$lib/services/assets.js', () => ({
	removeDerivedPreviewCacheForSource: removeDerivedPreviewCacheForSourceMock,
	removeVaultFile: removeVaultFileMock,
	removePreparedEvidenceCacheForSource: removePreparedEvidenceCacheForSourceMock,
	readVaultFile: readVaultFileMock,
	hashFileBytes: hashFileBytesMock
}));

vi.mock('$lib/utils/manual-order.js', () => ({
	buildMergedManualOrderIds: vi.fn((existingIds: string[], visibleOrderedIds: string[]) =>
		existingIds.filter((id) => !visibleOrderedIds.includes(id)).concat(visibleOrderedIds)
	)
}));

vi.mock('$lib/utils/project-contact.js', () => ({
	resolveProjectContactLink: resolveProjectContactLinkMock,
	resolveProjectRequesterLink: resolveProjectRequesterLinkMock,
	normaliseContactName: vi.fn((value: string) => value.trim().toLowerCase())
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

describe('project reconciliation', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		contactsStateMock.list = [];
		contactsStateMock.companyContacts = [];
		dbServiceMock.getDatabasePath.mockReset().mockReturnValue('sqlite:workspaces/ws/workspace.db');
		isTauriMock.mockReturnValue(false);
		invokeMock.mockReset().mockImplementation(async (command: string) => {
			if (command === 'generate_uuid') return 'project-saved';
			if (command === 'ingest_file') return 'workspaces/ws/vault/project-saved/import.pdf';
			return undefined;
		});
		readVaultFileMock.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
		hashFileBytesMock.mockReset().mockResolvedValue('a'.repeat(64));
		dbServiceMock.createProjectWorkspace.mockReset().mockResolvedValue(undefined);
		dbServiceMock.updateProjectWorkspace.mockReset().mockResolvedValue(undefined);
		dbServiceMock.getProjectById.mockReset();
		explorerStateMock.refreshProjectBranch.mockReset();
		errorStateMock.catchError.mockReset().mockResolvedValue(undefined);
		explorerStateMock.refreshProjectBranch.mockResolvedValue(undefined);
		removeDerivedPreviewCacheForSourceMock.mockResolvedValue(undefined);
		removeVaultFileMock.mockResolvedValue(undefined);
		removePreparedEvidenceCacheForSourceMock.mockResolvedValue(undefined);
		resolveProjectContactLinkMock.mockResolvedValue({
			contactId: null,
			contactNameSnapshot: null,
			createdContact: null
		});
		resolveProjectRequesterLinkMock.mockResolvedValue({
			requesterContactId: null,
			requesterNameSnapshot: null,
			createdRequester: null
		});
		storeServiceMock.getActiveProjectId.mockResolvedValue(null);
	});

	it.each([
		['create', 'read'],
		['create', 'explorer'],
		['update', 'read'],
		['update', 'explorer']
	] as const)(
		'preserves committed %s files and contacts after a deferred %s failure and retries only reads',
		async (operation, failureStage) => {
			const { projectsState } = await import('./projects.svelte');
			isTauriMock.mockReturnValue(true);
			resolveProjectContactLinkMock.mockResolvedValueOnce({
				contactId: 'company-saved',
				contactNameSnapshot: 'Saved Company',
				createdContact: { id: 'company-saved', name: 'Saved Company' }
			});
			resolveProjectRequesterLinkMock.mockResolvedValueOnce({
				requesterContactId: 'person-saved',
				requesterNameSnapshot: 'Saved Person',
				createdRequester: { id: 'person-saved', name: 'Saved Person' }
			});
			const savedProject = {
				id: 'project-saved',
				workspace_id: 'ws',
				sort_order: 0,
				rfq_number: 'RFQ-SAVED',
				created_at: '2026-10-10T00:00:00.000Z',
				updated_at: '2026-10-10T00:00:00.000Z',
				status: ProjectStatus.Open,
				is_favourite: false,
				contact_name: 'Saved Company',
				asset_count: 0
			};
			dbServiceMock.getProjectById.mockResolvedValue(savedProject);
			let rejectRefresh!: (error: Error) => void;
			const pendingRefresh = new Promise((_, reject) => {
				rejectRefresh = reject;
			});
			const refreshOperation =
				failureStage === 'read'
					? dbServiceMock.getProjectById
					: explorerStateMock.refreshProjectBranch;
			refreshOperation.mockReturnValueOnce(pendingRefresh);
			const files = [{ path: '/tmp/synthetic-import.pdf' }];
			const save =
				operation === 'create'
					? projectsState.addProject(
							'RFQ-SAVED',
							null,
							'Saved Company',
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							files,
							null,
							'Saved Person'
						)
					: projectsState.updateProject(
							'project-saved',
							'RFQ-SAVED',
							null,
							'Saved Company',
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							files,
							null,
							'Saved Person'
						);
			const writeOperation =
				operation === 'create'
					? dbServiceMock.createProjectWorkspace
					: dbServiceMock.updateProjectWorkspace;
			await vi.waitFor(() => expect(refreshOperation).toHaveBeenCalled());
			expect(writeOperation).toHaveBeenCalledTimes(1);
			rejectRefresh(new Error('Synthetic post-commit refresh failure'));
			await save.catch(() => undefined);
			expect(removeVaultFileMock).not.toHaveBeenCalled();
			expect(removeDerivedPreviewCacheForSourceMock).not.toHaveBeenCalled();
			expect(removePreparedEvidenceCacheForSourceMock).not.toHaveBeenCalled();
			expect(dbServiceMock.deleteContact).not.toHaveBeenCalled();
			await expect(save).resolves.toBeUndefined();
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'RFQ RFQ-SAVED saved',
				expect.any(Function),
				{ description: 'Your RFQ and files were saved. Retry to refresh the view.' }
			);
			const retryRefresh = errorStateMock.catchError.mock.calls[0][2];
			retryRefresh();
			await vi.waitFor(() =>
				expect(explorerStateMock.refreshProjectBranch).toHaveBeenCalledTimes(
					failureStage === 'explorer' ? 2 : 1
				)
			);
			expect(projectsState.list[0]?.id).toBe('project-saved');
			expect(dbServiceMock.getProjectById).toHaveBeenLastCalledWith('project-saved');
			expect(writeOperation).toHaveBeenCalledTimes(1);
			expect(invokeMock.mock.calls.filter(([command]) => command === 'ingest_file')).toHaveLength(
				1
			);
			expect(dbServiceMock.deleteContact).not.toHaveBeenCalled();
			expect(removeVaultFileMock).not.toHaveBeenCalled();
		}
	);

	it.each(['before retry', 'during retry'] as const)(
		'does not reload or patch a saved RFQ into a different workspace when it switches %s',
		async (switchStage) => {
			const { projectsState } = await import('./projects.svelte');
			dbServiceMock.getProjectById.mockRejectedValueOnce(new Error('Synthetic saved-read failure'));
			await projectsState.addProject('RFQ-SAVED');
			let finishRead!: (project: unknown) => void;
			dbServiceMock.getProjectById.mockReturnValueOnce(
				new Promise((resolve) => {
					finishRead = resolve;
				})
			);
			const retryRefresh = errorStateMock.catchError.mock.calls[0][2];
			if (switchStage === 'before retry') {
				dbServiceMock.getDatabasePath.mockReturnValue('sqlite:workspaces/other/workspace.db');
			}
			retryRefresh();
			if (switchStage === 'during retry') {
				await vi.waitFor(() => expect(dbServiceMock.getProjectById).toHaveBeenCalledTimes(2));
				dbServiceMock.getDatabasePath.mockReturnValue('sqlite:workspaces/other/workspace.db');
				finishRead({ id: dbServiceMock.createProjectWorkspace.mock.calls[0][0].id });
			}
			await vi.waitFor(() => expect(errorStateMock.catchError).toHaveBeenCalledTimes(2));
			expect(dbServiceMock.getProjectById).toHaveBeenCalledTimes(
				switchStage === 'before retry' ? 1 : 2
			);
			expect(explorerStateMock.refreshProjectBranch).not.toHaveBeenCalled();
			expect(projectsState.list).toEqual([]);
			expect(dbServiceMock.createProjectWorkspace).toHaveBeenCalledTimes(1);
			expect(errorStateMock.catchError).toHaveBeenLastCalledWith(
				expect.any(Error),
				'RFQ RFQ-SAVED saved',
				expect.any(Function),
				{
					description:
						'Your RFQ and files were saved in another workspace. Return to that workspace to refresh the view.'
				}
			);
		}
	);

	it.each([
		['metadata read', readVaultFileMock],
		['hashing', hashFileBytesMock]
	])(
		'removes the owned copy when %s fails before the file can be registered',
		async (_stage, operation) => {
			const { projectsState } = await import('./projects.svelte');
			isTauriMock.mockReturnValue(true);
			operation.mockRejectedValueOnce(new Error('Synthetic staged-file failure'));
			await expect(
				projectsState.addProject(
					'RFQ-UNCOMMITTED',
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					[{ path: '/tmp/synthetic-import.pdf' }]
				)
			).rejects.toThrow('Synthetic staged-file failure');
			expect(dbServiceMock.createProjectWorkspace).not.toHaveBeenCalled();
			expect(removeVaultFileMock).toHaveBeenCalledExactlyOnceWith(
				'workspaces/ws/vault/project-saved/import.pdf'
			);
			expect(removeDerivedPreviewCacheForSourceMock).toHaveBeenCalledWith(
				'workspaces/ws/vault/project-saved/import.pdf'
			);
			expect(removePreparedEvidenceCacheForSourceMock).toHaveBeenCalledWith(
				'workspaces/ws/vault/project-saved/import.pdf'
			);
			expect(removeVaultFileMock).not.toHaveBeenCalledWith('/tmp/synthetic-import.pdf');
		}
	);

	it('rolls back only uncommitted update files and inline contacts after the write fails', async () => {
		const { projectsState } = await import('./projects.svelte');
		isTauriMock.mockReturnValue(true);
		resolveProjectContactLinkMock.mockResolvedValueOnce({
			contactId: 'company-uncommitted',
			contactNameSnapshot: 'Uncommitted Company',
			createdContact: { id: 'company-uncommitted', name: 'Uncommitted Company' }
		});
		resolveProjectRequesterLinkMock.mockResolvedValueOnce({
			requesterContactId: 'person-uncommitted',
			requesterNameSnapshot: 'Uncommitted Person',
			createdRequester: { id: 'person-uncommitted', name: 'Uncommitted Person' }
		});
		dbServiceMock.updateProjectWorkspace.mockRejectedValueOnce(
			new Error('Synthetic uncommitted update failure')
		);
		await expect(
			projectsState.updateProject(
				'project-saved',
				'RFQ-UNCOMMITTED',
				null,
				'Uncommitted Company',
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				[{ path: '/tmp/synthetic-import.pdf' }],
				null,
				'Uncommitted Person'
			)
		).rejects.toThrow('Synthetic uncommitted update failure');
		expect(removeVaultFileMock).toHaveBeenCalledExactlyOnceWith(
			'workspaces/ws/vault/project-saved/import.pdf'
		);
		expect(dbServiceMock.deleteContact).toHaveBeenNthCalledWith(1, 'person-uncommitted');
		expect(dbServiceMock.deleteContact).toHaveBeenNthCalledWith(2, 'company-uncommitted');
		expect(dbServiceMock.getProjectById).not.toHaveBeenCalled();
	});

	it('patches projects in place after add, update, duplicate, and delete without refreshing the full list', async () => {
		const { projectsState } = await import('./projects.svelte');

		projectsState.list = [
			{
				id: 'project-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				rfq_number: 'RFQ-1001',
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z',
				status: ProjectStatus.Draft,
				is_favourite: false,
				contact_name: 'Acme',
				asset_count: 0
			}
		];

		dbServiceMock.getProjectById.mockResolvedValueOnce({
			id: 'project-2',
			workspace_id: 'owner-1',
			sort_order: 1,
			rfq_number: 'RFQ-1002',
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z',
			status: ProjectStatus.Archived,
			is_favourite: false,
			contact_name: null,
			asset_count: 0
		});
		await projectsState.addProject('RFQ-1002');

		expect(dbServiceMock.createProjectWorkspace).toHaveBeenCalled();

		expect(projectsState.list.map((project) => project.id)).toEqual(['project-1', 'project-2']);
		expect(dbServiceMock.getProjects).not.toHaveBeenCalled();
		expect(explorerStateMock.syncProjects).toHaveBeenCalledWith(projectsState.list);
		expect(explorerStateMock.refreshProjectBranch).toHaveBeenCalledWith('project-2');

		dbServiceMock.getProjectById.mockResolvedValueOnce({
			id: 'project-1',
			workspace_id: 'owner-1',
			sort_order: 0,
			rfq_number: 'RFQ-1001A',
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z',
			status: ProjectStatus.Open,
			is_favourite: false,
			contact_name: 'Acme',
			asset_count: 0
		});
		await projectsState.updateProject(
			'project-1',
			'RFQ-1001A',
			null,
			undefined,
			undefined,
			undefined
		);

		expect(dbServiceMock.updateProjectWorkspace).toHaveBeenCalled();

		expect(projectsState.list[0]?.rfq_number).toBe('RFQ-1001A');
		expect(dbServiceMock.getProjects).not.toHaveBeenCalled();
		expect(explorerStateMock.refreshProjectBranch).toHaveBeenCalledWith('project-1');

		dbServiceMock.duplicateProject.mockResolvedValueOnce('project-3');
		dbServiceMock.getProjectById.mockResolvedValueOnce({
			id: 'project-3',
			workspace_id: 'owner-1',
			sort_order: 2,
			rfq_number: 'RFQ-1003',
			created_at: '2026-03-09T00:03:00.000Z',
			updated_at: '2026-03-09T00:03:00.000Z',
			status: ProjectStatus.Draft,
			is_favourite: false,
			contact_name: 'Acme',
			asset_count: 0
		});
		await projectsState.duplicateProject('project-1');

		expect(projectsState.list.map((project) => project.id)).toEqual([
			'project-1',
			'project-2',
			'project-3'
		]);
		expect(dbServiceMock.getProjects).not.toHaveBeenCalled();
		expect(explorerStateMock.refreshProjectBranch).toHaveBeenCalledWith('project-3');

		await projectsState.deleteProject('project-2');

		expect(projectsState.list.map((project) => project.id)).toEqual(['project-1', 'project-3']);
		expect(dbServiceMock.getProjects).not.toHaveBeenCalled();
		expect(explorerStateMock.removeProjects).toHaveBeenCalledWith(['project-2']);
	});

	it('removes inline contacts and staged files when project workspace persistence fails', async () => {
		const { projectsState } = await import('./projects.svelte');

		resolveProjectContactLinkMock.mockResolvedValueOnce({
			contactId: 'contact-created',
			contactNameSnapshot: 'Atlas Steel',
			createdContact: { id: 'contact-created', name: 'Atlas Steel' }
		});
		resolveProjectRequesterLinkMock.mockResolvedValueOnce({
			requesterContactId: 'requester-created',
			requesterNameSnapshot: 'Mia Collins',
			createdRequester: { id: 'requester-created', name: 'Mia Collins' }
		});
		dbServiceMock.createProjectWorkspace.mockRejectedValueOnce(new Error('file insert failed'));
		dbServiceMock.deleteContact.mockResolvedValue(undefined);

		await expect(
			projectsState.addProject(
				'RFQ-2000',
				null,
				'Atlas Steel',
				'Warehouse',
				'2026-04-15',
				undefined,
				undefined,
				undefined,
				undefined,
				[{ path: '/tmp/drawing-a.pdf' }],
				null,
				'Mia Collins'
			)
		).rejects.toThrow('file insert failed');

		expect(removeDerivedPreviewCacheForSourceMock).toHaveBeenCalled();
		expect(removeVaultFileMock).toHaveBeenCalled();
		expect(dbServiceMock.deleteContact).toHaveBeenNthCalledWith(1, 'requester-created');
		expect(dbServiceMock.deleteContact).toHaveBeenNthCalledWith(2, 'contact-created');
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Create RFQ RFQ-2000'
		);
	});

	it('archives and restores RFQs through narrow project patches and only hard-deletes archived RFQs', async () => {
		const { projectsState } = await import('./projects.svelte');

		projectsState.list = [
			{
				id: 'project-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				rfq_number: 'RFQ-1001',
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z',
				status: ProjectStatus.Open,
				is_favourite: false,
				contact_name: 'Acme',
				asset_count: 0
			},
			{
				id: 'project-2',
				workspace_id: 'owner-1',
				sort_order: 1,
				rfq_number: 'RFQ-1002',
				created_at: '2026-03-09T00:01:00.000Z',
				updated_at: '2026-03-09T00:01:00.000Z',
				status: ProjectStatus.Archived,
				is_favourite: false,
				contact_name: 'Bravo',
				asset_count: 0
			}
		];

		dbServiceMock.getProjectById.mockResolvedValueOnce({
			...projectsState.list[0],
			status: ProjectStatus.Archived,
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await projectsState.archiveProject('project-1');

		expect(dbServiceMock.updateProject).toHaveBeenCalledWith(
			'project-1',
			'RFQ-1001',
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			ProjectStatus.Archived,
			undefined,
			undefined,
			null,
			undefined,
			'manual',
			undefined
		);
		expect(projectsState.list.find((project) => project.id === 'project-1')?.status).toBe(
			ProjectStatus.Archived
		);
		expect(toastMock.success).toHaveBeenCalledWith('RFQ RFQ-1001 archived');

		dbServiceMock.getProjectById.mockResolvedValueOnce({
			...projectsState.list[1],
			status: ProjectStatus.Open,
			updated_at: '2026-03-09T00:03:00.000Z'
		});
		await projectsState.restoreProject('project-2');

		expect(projectsState.list.find((project) => project.id === 'project-2')?.status).toBe(
			ProjectStatus.Open
		);
		expect(toastMock.success).toHaveBeenCalledWith('RFQ RFQ-1002 restored');

		await projectsState.deleteProject('project-1');

		expect(dbServiceMock.deleteProject).toHaveBeenCalledTimes(1);
		expect(errorStateMock.catchError).not.toHaveBeenCalledWith(
			expect.anything(),
			'Delete project project-1'
		);
		expect(projectsState.list.find((project) => project.id === 'project-1')).toBeUndefined();

		await projectsState.deleteProject('project-2');

		expect(dbServiceMock.deleteProject).toHaveBeenCalledTimes(1);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Delete project project-2'
		);
		expect(projectsState.list.find((project) => project.id === 'project-2')).toBeDefined();
	});

	it('restores RFQ order locally and swallows the persistence error when manual reorder fails', async () => {
		const { projectsState } = await import('./projects.svelte');

		projectsState.list = [
			{
				id: 'project-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				rfq_number: 'RFQ-1001',
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z',
				status: ProjectStatus.Draft,
				is_favourite: false,
				contact_name: 'Acme',
				asset_count: 0
			},
			{
				id: 'project-2',
				workspace_id: 'owner-1',
				sort_order: 1,
				rfq_number: 'RFQ-1002',
				created_at: '2026-03-09T00:01:00.000Z',
				updated_at: '2026-03-09T00:01:00.000Z',
				status: ProjectStatus.Draft,
				is_favourite: false,
				contact_name: 'Beta',
				asset_count: 0
			}
		];

		dbServiceMock.reorderProjects = vi.fn().mockRejectedValueOnce(new Error('reorder failed'));

		await expect(
			projectsState.reorderProjects(['project-2', 'project-1'])
		).resolves.toBeUndefined();

		expect(projectsState.list.map((project) => project.id)).toEqual(['project-1', 'project-2']);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(expect.any(Error), 'Reorder RFQs');
	});

	it('toggles project favourites through a narrow project patch', async () => {
		const { projectsState } = await import('./projects.svelte');

		projectsState.list = [
			{
				id: 'project-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				rfq_number: 'RFQ-1001',
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z',
				status: ProjectStatus.Draft,
				is_favourite: false,
				contact_name: 'Acme',
				asset_count: 0
			}
		];

		dbServiceMock.getProjectById.mockResolvedValueOnce({
			id: 'project-1',
			workspace_id: 'owner-1',
			sort_order: 0,
			rfq_number: 'RFQ-1001',
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-10T00:00:00.000Z',
			status: ProjectStatus.Draft,
			is_favourite: true,
			contact_name: 'Acme',
			asset_count: 0
		});

		await projectsState.toggleFavourite('project-1');

		expect(dbServiceMock.setProjectFavourite).toHaveBeenCalledWith('project-1', true);
		expect(projectsState.list[0]?.is_favourite).toBe(true);
		expect(dbServiceMock.getProjects).not.toHaveBeenCalled();
		expect(toastMock.success).toHaveBeenCalledWith('RFQ RFQ-1001 added to favourites');
	});

	it('swallows duplicate and favourite failures after routing them through errorState for fire-and-forget UI handlers', async () => {
		const { projectsState } = await import('./projects.svelte');

		projectsState.list = [
			{
				id: 'project-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				rfq_number: 'RFQ-1001',
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z',
				status: ProjectStatus.Draft,
				is_favourite: false,
				contact_name: 'Acme',
				asset_count: 0
			}
		];

		dbServiceMock.duplicateProject.mockRejectedValueOnce(new Error('duplicate failed'));
		await expect(projectsState.duplicateProject('project-1')).resolves.toBeUndefined();
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate RFQ project-1'
		);

		dbServiceMock.setProjectFavourite.mockRejectedValueOnce(new Error('toggle failed'));
		await expect(projectsState.toggleFavourite('project-1')).resolves.toBeUndefined();
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Toggle favourite project-1'
		);
	});

	it('cleans up both derived preview cache and the vault file when a staged upload rolls back', async () => {
		const { projectsState } = await import('./projects.svelte');

		dbServiceMock.createProjectWorkspace.mockRejectedValueOnce(new Error('insert failed'));

		await expect(
			projectsState.addProject(
				'RFQ-ROLLBACK',
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				[{ path: '/tmp/spec.docx' }]
			)
		).rejects.toThrow('insert failed');

		expect(removeDerivedPreviewCacheForSourceMock).toHaveBeenCalledWith('/tmp/spec.docx');
		expect(removeVaultFileMock).toHaveBeenCalledWith('/tmp/spec.docx');
	});

	it('creates project with a new company and no requester contact when requester details are empty', async () => {
		const { projectsState } = await import('./projects.svelte');

		resolveProjectContactLinkMock.mockResolvedValueOnce({
			contactId: 'contact-new-company',
			contactNameSnapshot: 'New Company Corp',
			createdContact: { id: 'contact-new-company', name: 'New Company Corp' }
		});
		resolveProjectRequesterLinkMock.mockResolvedValueOnce({
			requesterContactId: null,
			requesterNameSnapshot: null,
			createdRequester: null
		});

		dbServiceMock.getProjectById.mockResolvedValueOnce({
			id: 'project-new-1',
			workspace_id: 'owner-1',
			sort_order: 1,
			rfq_number: 'RFQ-NEW-1',
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z',
			status: ProjectStatus.Draft,
			is_favourite: false,
			contact_name: 'New Company Corp',
			asset_count: 0
		});

		await projectsState.addProject(
			'RFQ-NEW-1',
			null,
			'New Company Corp',
			'New Project',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			undefined
		);

		expect(dbServiceMock.createProjectWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				rfqNumber: 'RFQ-NEW-1',
				contactId: 'contact-new-company',
				contactNameSnapshot: 'New Company Corp',
				projectName: 'New Project',
				requesterContactId: null,
				requesterNameSnapshot: undefined
			})
		);
	});
});
