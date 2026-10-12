import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbServiceMock = {
	getClassificationSystemById: vi.fn(),
	addClassificationSystem: vi.fn(),
	updateClassificationSystem: vi.fn(),
	deleteClassificationSystem: vi.fn(),
	getClassificationSystems: vi.fn(),
	getCostCodeById: vi.fn(),
	getCostCodes: vi.fn(),
	addCostCode: vi.fn(),
	updateCostCode: vi.fn(),
	deleteCostCode: vi.fn(),
	getWbsNodeById: vi.fn(),
	getWbsNodes: vi.fn(),
	addWbsNode: vi.fn(),
	updateWbsNode: vi.fn(),
	deleteWbsNode: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const toastMock = {
	success: vi.fn()
};

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('../utils/env', () => ({
	isTauri: () => false
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

describe('tree-backed reconciliation', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('patches classification systems and cost codes in place, including cascade removals, without broad reloads', async () => {
		const { classificationSystemsState } = await import('./classification-systems.svelte');

		classificationSystemsState.list = [
			{
				id: 'system-1',
				workspace_id: 'owner-1',
				name: 'Zulu System',
				code: 'ZULU',
				classification_type: 'custom',
				aliases: [],
				is_default: false,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];
		classificationSystemsState.activeSystemId = 'system-1';
		classificationSystemsState.costCodes = [
			{
				id: 'code-root',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '02',
				name: 'Root',
				description: '',
				is_active: true,
				sort_order: 2,
				created_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'code-child',
				classification_system_id: 'system-1',
				parent_id: 'code-root',
				code: '02.01',
				name: 'Child',
				description: '',
				is_active: true,
				sort_order: 3,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getClassificationSystemById.mockResolvedValueOnce({
			id: 'system-2',
			workspace_id: 'owner-1',
			name: 'Alpha System',
			code: 'ALPHA',
			classification_type: 'custom',
			aliases: [],
			is_default: false,
			created_at: '2026-03-09T00:01:00.000Z'
		});
		await classificationSystemsState.addClassificationSystem({
			name: 'Alpha System',
			code: 'ALPHA',
			classification_type: 'custom',
			aliases: [],
			is_default: false
		});

		expect(classificationSystemsState.list.map((item) => item.name)).toEqual([
			'Alpha System',
			'Zulu System'
		]);
		expect(dbServiceMock.getClassificationSystems).not.toHaveBeenCalled();

		dbServiceMock.getCostCodes.mockResolvedValueOnce([
			{
				id: 'source-root',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '01',
				name: 'Source Root',
				description: '',
				is_active: true,
				sort_order: 1,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);
		dbServiceMock.getClassificationSystemById.mockResolvedValueOnce({
			id: 'system-3',
			workspace_id: 'owner-1',
			name: 'Bravo System Copy',
			code: 'BRAVO',
			classification_type: 'custom',
			is_default: false,
			created_at: '2026-03-09T00:02:00.000Z'
		});
		await classificationSystemsState.duplicateClassificationSystem('system-1');

		expect(classificationSystemsState.list.map((item) => item.name)).toEqual([
			'Alpha System',
			'Bravo System Copy',
			'Zulu System'
		]);
		expect(dbServiceMock.getClassificationSystems).not.toHaveBeenCalled();

		dbServiceMock.getCostCodeById.mockResolvedValueOnce({
			id: 'code-early',
			classification_system_id: 'system-1',
			parent_id: null,
			code: '01',
			name: 'Earlier',
			description: '',
			is_active: true,
			sort_order: 1,
			created_at: '2026-03-09T00:03:00.000Z'
		});
		await classificationSystemsState.addCostCode('system-1', {
			parent_id: null,
			code: '01',
			name: 'Earlier',
			description: '',
			is_active: true,
			sort_order: 1
		});

		expect(classificationSystemsState.costCodes.map((item) => item.code)).toEqual([
			'01',
			'02',
			'02.01'
		]);

		dbServiceMock.getCostCodeById.mockResolvedValueOnce({
			id: 'code-root',
			classification_system_id: 'system-1',
			parent_id: null,
			code: '00',
			name: 'Root Updated',
			description: '',
			is_active: true,
			sort_order: 0,
			created_at: '2026-03-09T00:00:00.000Z'
		});
		await classificationSystemsState.updateCostCode('code-root', {
			parent_id: null,
			code: '00',
			name: 'Root Updated',
			description: '',
			is_active: true,
			sort_order: 0
		});

		expect(classificationSystemsState.costCodes.map((item) => item.code)).toEqual([
			'00',
			'01',
			'02.01'
		]);
		expect(dbServiceMock.getCostCodes).toHaveBeenCalledTimes(1);

		await classificationSystemsState.deleteCostCode('code-root');

		expect(classificationSystemsState.costCodes.map((item) => item.id)).toEqual(['code-early']);
		expect(dbServiceMock.getCostCodes).toHaveBeenCalledTimes(1);

		await classificationSystemsState.deleteClassificationSystem('system-1');

		expect(classificationSystemsState.list.map((item) => item.id)).toEqual([
			'system-2',
			'system-3'
		]);
		expect(classificationSystemsState.activeSystemId).toBeNull();
		expect(classificationSystemsState.costCodes).toEqual([]);
		expect(dbServiceMock.getClassificationSystems).not.toHaveBeenCalled();
	});

	it('patches WBS nodes in place, including cascade removals, without broad reloads', async () => {
		const { wbsState } = await import('./wbs.svelte');

		wbsState.projectId = 'project-1';
		wbsState.list = [
			{
				id: 'wbs-root',
				project_id: 'project-1',
				parent_id: null,
				code: '02',
				name: 'Root',
				type: 'phase',
				sort_order: 2,
				created_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'wbs-child',
				project_id: 'project-1',
				parent_id: 'wbs-root',
				code: '02.01',
				name: 'Child',
				type: 'zone',
				sort_order: 3,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getWbsNodeById.mockResolvedValueOnce({
			id: 'wbs-early',
			project_id: 'project-1',
			parent_id: null,
			code: '01',
			name: 'Earlier',
			type: 'phase',
			sort_order: 1,
			created_at: '2026-03-09T00:01:00.000Z'
		});
		await wbsState.addNode('project-1', {
			parent_id: null,
			code: '01',
			name: 'Earlier',
			type: 'phase',
			sort_order: 1
		});

		expect(wbsState.list.map((item) => item.code)).toEqual(['01', '02', '02.01']);
		expect(dbServiceMock.getWbsNodes).not.toHaveBeenCalled();

		dbServiceMock.getWbsNodeById.mockResolvedValueOnce({
			id: 'wbs-root',
			project_id: 'project-1',
			parent_id: null,
			code: '00',
			name: 'Root Updated',
			type: 'phase',
			sort_order: 0,
			created_at: '2026-03-09T00:00:00.000Z'
		});
		await wbsState.updateNode('wbs-root', {
			parent_id: null,
			code: '00',
			name: 'Root Updated',
			type: 'phase',
			sort_order: 0
		});

		expect(wbsState.list.map((item) => item.code)).toEqual(['00', '01', '02.01']);
		expect(dbServiceMock.getWbsNodes).not.toHaveBeenCalled();

		await wbsState.deleteNode('wbs-root');

		expect(wbsState.list.map((item) => item.id)).toEqual(['wbs-early']);
		expect(dbServiceMock.getWbsNodes).not.toHaveBeenCalled();
	});

	it('clears stale WBS nodes before hydrating a different project', async () => {
		const { wbsState } = await import('./wbs.svelte');

		wbsState.projectId = 'project-1';
		wbsState.searchQuery = 'root';
		wbsState.list = [
			{
				id: 'wbs-old',
				project_id: 'project-1',
				parent_id: null,
				code: 'OLD',
				name: 'Old Root',
				type: 'phase',
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];

		let resolveNodes: ((nodes: typeof wbsState.list) => void) | undefined;
		dbServiceMock.getWbsNodes.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveNodes = resolve;
				})
		);

		const hydratePromise = wbsState.hydrate('project-2');

		expect(wbsState.projectId).toBe('project-2');
		expect(wbsState.searchQuery).toBe('');
		expect(wbsState.list).toEqual([]);

		resolveNodes?.([
			{
				id: 'wbs-new',
				project_id: 'project-2',
				parent_id: null,
				code: 'NEW',
				name: 'New Root',
				type: 'phase',
				sort_order: 0,
				created_at: '2026-03-09T00:01:00.000Z'
			}
		]);
		await hydratePromise;

		expect(wbsState.list.map((item) => item.id)).toEqual(['wbs-new']);
	});

	it('swallows classification duplication failures after routing them through errorState', async () => {
		const { classificationSystemsState } = await import('./classification-systems.svelte');

		classificationSystemsState.list = [
			{
				id: 'system-fail',
				workspace_id: 'owner-1',
				name: 'System Fail',
				code: 'FAIL',
				classification_type: 'custom',
				aliases: [],
				is_default: false,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getCostCodes.mockResolvedValueOnce([]);
		dbServiceMock.addClassificationSystem.mockRejectedValueOnce(
			new Error('classification duplicate failed')
		);

		await expect(
			classificationSystemsState.duplicateClassificationSystem('system-fail')
		).resolves.toBeUndefined();

		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate classification system system-fail'
		);
	});

	it('treats repeated classification-system selection as idempotent once cost codes are hydrated', async () => {
		const { classificationSystemsState } = await import('./classification-systems.svelte');

		dbServiceMock.getCostCodes.mockResolvedValue([
			{
				id: 'code-1',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '01',
				name: 'Root',
				description: '',
				is_active: true,
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		await classificationSystemsState.selectSystem('system-1');
		classificationSystemsState.costCodeSearchQuery = 'root';
		await classificationSystemsState.selectSystem('system-1');

		expect(dbServiceMock.getCostCodes).toHaveBeenCalledTimes(1);
		expect(classificationSystemsState.activeSystemId).toBe('system-1');
		expect(classificationSystemsState.costCodeSearchQuery).toBe('root');

		await classificationSystemsState.refreshCostCodes();

		expect(dbServiceMock.getCostCodes).toHaveBeenCalledTimes(2);
	});

	it('does not let a stale empty classification hydrate overwrite a newly created system', async () => {
		let resolveSystems:
			| ((
					value: Array<{
						id: string;
						workspace_id: string;
						name: string;
						code: string;
						type: 'uniformat' | 'masterformat' | 'custom';
						aliases: string[];
						is_default: boolean;
						created_at: string;
					}>
			  ) => void)
			| undefined;
		dbServiceMock.getClassificationSystems.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveSystems = resolve;
				})
		);

		const { classificationSystemsState } = await import('./classification-systems.svelte');

		const hydrateTask = classificationSystemsState.hydrate();

		dbServiceMock.getClassificationSystemById.mockResolvedValueOnce({
			id: 'system-1',
			workspace_id: 'owner-1',
			name: 'First System',
			code: 'FIRST',
			classification_type: 'custom',
			aliases: [],
			is_default: true,
			created_at: '2026-03-31T00:00:00.000Z'
		});

		await classificationSystemsState.addClassificationSystem({
			name: 'First System',
			code: 'FIRST',
			classification_type: 'custom',
			aliases: [],
			is_default: true
		});

		resolveSystems?.([]);
		await hydrateTask;

		expect(classificationSystemsState.list.map((item) => item.name)).toEqual(['First System']);
		expect(dbServiceMock.getClassificationSystems).toHaveBeenCalledTimes(1);
	});

	it('clears classification selection idempotently when the split view returns to the list route', async () => {
		const { classificationSystemsState } = await import('./classification-systems.svelte');

		classificationSystemsState.activeSystemId = 'system-1';
		classificationSystemsState.costCodes = [
			{
				id: 'code-1',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '01',
				name: 'Root',
				description: '',
				is_active: true,
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];
		classificationSystemsState.costCodeSearchQuery = 'root';

		await classificationSystemsState.selectSystem(null);
		await classificationSystemsState.selectSystem(null);

		expect(classificationSystemsState.activeSystemId).toBeNull();
		expect(classificationSystemsState.costCodes).toEqual([]);
		expect(classificationSystemsState.costCodeSearchQuery).toBe('');
		expect(dbServiceMock.getCostCodes).not.toHaveBeenCalled();
	});
});
