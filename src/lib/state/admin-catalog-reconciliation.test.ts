import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbServiceMock = {
	getLabourRateCardById: vi.fn(),
	addLabourRateCard: vi.fn(),
	updateLabourRateCard: vi.fn(),
	deleteLabourRateCard: vi.fn(),
	getLabourRateCards: vi.fn(),
	getEquipmentRateCardById: vi.fn(),
	addEquipmentRateCard: vi.fn(),
	updateEquipmentRateCard: vi.fn(),
	deleteEquipmentRateCard: vi.fn(),
	getEquipmentRateCards: vi.fn(),
	getCostComponentPresetById: vi.fn(),
	updateCostComponentPreset: vi.fn(),
	addCostComponentPreset: vi.fn(),
	deleteCostComponentPreset: vi.fn(),
	getCostComponentPresets: vi.fn(),
	getEstimateTemplateById: vi.fn(),
	updateEstimateTemplate: vi.fn(),
	addEstimateTemplate: vi.fn(),
	deleteEstimateTemplate: vi.fn(),
	getEstimateTemplates: vi.fn(),
	getProjectStructureTemplateById: vi.fn(),
	updateProjectStructureTemplate: vi.fn(),
	addProjectStructureTemplate: vi.fn(),
	deleteProjectStructureTemplate: vi.fn(),
	getProjectStructureTemplates: vi.fn()
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

describe('admin catalogue reconciliation', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('patches labour and equipment lists in place without broad reloads and preserves name ordering', async () => {
		const { labourRatesState } = await import('./labour-rates.svelte');
		const { equipmentRatesState } = await import('./equipment-rates.svelte');

		labourRatesState.list = [
			{
				id: 'labour-1',
				workspace_id: 'owner-1',
				code: 'LAB-002',
				name: 'Zulu Labour',
				category: 'Shop',
				work_center: 'Z',
				unit: 'hr',
				default_rate: 100,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		equipmentRatesState.list = [
			{
				id: 'equipment-1',
				workspace_id: 'owner-1',
				code: 'EQ-002',
				name: 'Zulu Crane',
				category: 'Cranes',
				work_center: 'Yard',
				unit: 'hr',
				default_rate: 240,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getLabourRateCardById.mockResolvedValueOnce({
			id: 'labour-2',
			workspace_id: 'owner-1',
			code: 'LAB-001',
			name: 'Alpha Labour',
			category: 'Site',
			work_center: 'A',
			unit: 'hr',
			default_rate: 90,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z'
		});
		await labourRatesState.addLabourRate({
			code: 'LAB-001',
			name: 'Alpha Labour',
			aliases: [],
			category: 'Site',
			work_center: 'A',
			unit: 'hr',
			default_rate: 90,
			is_active: true
		});

		expect(labourRatesState.list.map((item) => item.name)).toEqual(['Alpha Labour', 'Zulu Labour']);
		expect(dbServiceMock.getLabourRateCards).not.toHaveBeenCalled();

		dbServiceMock.getLabourRateCardById.mockResolvedValueOnce({
			id: 'labour-3',
			workspace_id: 'owner-1',
			code: 'LAB-003',
			name: 'Bravo Labour Copy',
			category: 'Site',
			work_center: 'B',
			unit: 'hr',
			default_rate: 95,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:02:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		labourRatesState.list = labourRatesState.list.concat({
			id: 'labour-source',
			workspace_id: 'owner-1',
			code: 'LAB-010',
			name: 'Bravo Labour',
			category: 'Site',
			work_center: 'B',
			unit: 'hr',
			default_rate: 95,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:02:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await labourRatesState.duplicateLabourRate('labour-source');

		expect(labourRatesState.list.map((item) => item.name)).toEqual([
			'Alpha Labour',
			'Bravo Labour',
			'Bravo Labour Copy',
			'Zulu Labour'
		]);
		expect(dbServiceMock.getLabourRateCards).not.toHaveBeenCalled();

		await labourRatesState.deleteLabourRate('labour-2');

		expect(labourRatesState.list.map((item) => item.id)).toEqual([
			'labour-source',
			'labour-3',
			'labour-1'
		]);
		expect(dbServiceMock.getLabourRateCards).not.toHaveBeenCalled();

		dbServiceMock.getEquipmentRateCardById.mockResolvedValueOnce({
			id: 'equipment-2',
			workspace_id: 'owner-1',
			code: 'EQ-001',
			name: 'Alpha Crane',
			category: 'Cranes',
			work_center: 'Yard',
			unit: 'hr',
			default_rate: 210,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z'
		});
		await equipmentRatesState.addEquipmentRate({
			code: 'EQ-001',
			name: 'Alpha Crane',
			aliases: [],
			category: 'Cranes',
			work_center: 'Yard',
			unit: 'hr',
			default_rate: 210,
			is_active: true
		});

		expect(equipmentRatesState.list.map((item) => item.name)).toEqual([
			'Alpha Crane',
			'Zulu Crane'
		]);
		expect(dbServiceMock.getEquipmentRateCards).not.toHaveBeenCalled();

		dbServiceMock.getEquipmentRateCardById.mockResolvedValueOnce({
			id: 'equipment-1',
			workspace_id: 'owner-1',
			code: 'EQ-002',
			name: 'Bravo Crane',
			category: 'Cranes',
			work_center: 'Yard',
			unit: 'hr',
			default_rate: 245,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:03:00.000Z'
		});
		await equipmentRatesState.updateEquipmentRate('equipment-1', {
			code: 'EQ-002',
			name: 'Bravo Crane',
			aliases: [],
			category: 'Cranes',
			work_center: 'Yard',
			unit: 'hr',
			default_rate: 245,
			is_active: true
		});

		expect(equipmentRatesState.list.map((item) => item.name)).toEqual([
			'Alpha Crane',
			'Bravo Crane'
		]);
		expect(dbServiceMock.getEquipmentRateCards).not.toHaveBeenCalled();
	});

	it('patches presets and templates in place without broad reloads and preserves name ordering', async () => {
		const { costComponentPresetsState } = await import('./cost-component-presets.svelte');
		const { estimateTemplatesState } = await import('./estimate-templates.svelte');

		costComponentPresetsState.list = [
			{
				id: 'preset-1',
				workspace_id: 'owner-1',
				code: 'PRE-002',
				name: 'Zulu Preset',
				description: 'Zulu',
				components: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'preset-source',
				workspace_id: 'owner-1',
				code: 'PRE-010',
				name: 'Bravo Preset',
				description: 'Bravo',
				components: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		estimateTemplatesState.list = [
			{
				id: 'template-1',
				workspace_id: 'owner-1',
				code: 'TPL-002',
				name: 'Zulu Template',
				description: 'Zulu',
				estimate: {
					scope_summary: '',
					notes: '',
					takeoff_items: []
				},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'template-source',
				workspace_id: 'owner-1',
				code: 'TPL-010',
				name: 'Bravo Template',
				description: 'Bravo',
				estimate: {
					scope_summary: '',
					notes: '',
					takeoff_items: []
				},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getCostComponentPresetById.mockResolvedValueOnce({
			id: 'preset-1',
			workspace_id: 'owner-1',
			code: 'PRE-002',
			name: 'Alpha Preset',
			description: 'Zulu',
			aliases: [],
			components: [],
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await costComponentPresetsState.updatePreset('preset-1', {
			code: 'PRE-002',
			name: 'Alpha Preset',
			description: 'Zulu',
			aliases: [],
			is_active: true
		});

		expect(costComponentPresetsState.list.map((item) => item.name)).toEqual([
			'Alpha Preset',
			'Bravo Preset'
		]);
		expect(dbServiceMock.getCostComponentPresets).not.toHaveBeenCalled();

		dbServiceMock.getCostComponentPresetById.mockResolvedValueOnce({
			id: 'preset-2',
			workspace_id: 'owner-1',
			code: null,
			name: 'Charlie Preset Copy',
			description: 'Bravo',
			aliases: [],
			components: [],
			is_active: true,
			created_at: '2026-03-09T00:03:00.000Z',
			updated_at: '2026-03-09T00:03:00.000Z'
		});
		await costComponentPresetsState.duplicatePreset('preset-source');

		expect(costComponentPresetsState.list.map((item) => item.name)).toEqual([
			'Alpha Preset',
			'Bravo Preset',
			'Charlie Preset Copy'
		]);
		expect(dbServiceMock.getCostComponentPresets).not.toHaveBeenCalled();

		await costComponentPresetsState.deletePreset('preset-source');

		expect(costComponentPresetsState.list.map((item) => item.id)).toEqual(['preset-1', 'preset-2']);
		expect(dbServiceMock.getCostComponentPresets).not.toHaveBeenCalled();

		dbServiceMock.getEstimateTemplateById.mockResolvedValueOnce({
			id: 'template-1',
			workspace_id: 'owner-1',
			code: 'TPL-002',
			name: 'Alpha Template',
			description: 'Zulu',
			aliases: [],
			estimate: {
				scope_summary: '',
				notes: '',
				takeoff_items: []
			},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await estimateTemplatesState.updateTemplate('template-1', {
			code: 'TPL-002',
			name: 'Alpha Template',
			description: 'Zulu',
			aliases: [],
			is_active: true
		});

		expect(estimateTemplatesState.list.map((item) => item.name)).toEqual([
			'Alpha Template',
			'Bravo Template'
		]);
		expect(dbServiceMock.getEstimateTemplates).not.toHaveBeenCalled();

		dbServiceMock.getEstimateTemplateById.mockResolvedValueOnce({
			id: 'template-2',
			workspace_id: 'owner-1',
			code: null,
			name: 'Charlie Template Copy',
			description: 'Bravo',
			estimate: {
				scope_summary: '',
				notes: '',
				takeoff_items: []
			},
			is_active: true,
			created_at: '2026-03-09T00:03:00.000Z',
			updated_at: '2026-03-09T00:03:00.000Z'
		});
		await estimateTemplatesState.duplicateTemplate('template-source');

		expect(estimateTemplatesState.list.map((item) => item.name)).toEqual([
			'Alpha Template',
			'Bravo Template',
			'Charlie Template Copy'
		]);
		expect(dbServiceMock.getEstimateTemplates).not.toHaveBeenCalled();

		await estimateTemplatesState.deleteTemplate('template-source');

		expect(estimateTemplatesState.list.map((item) => item.id)).toEqual([
			'template-1',
			'template-2'
		]);
		expect(dbServiceMock.getEstimateTemplates).not.toHaveBeenCalled();
	});

	it('patches project structure templates in place without broad reloads and preserves name ordering', async () => {
		const { projectStructureTemplatesState } = await import('./project-structure-templates.svelte');

		projectStructureTemplatesState.list = [
			{
				id: 'structure-template-1',
				workspace_id: 'owner-1',
				code: 'STR-002',
				name: 'Zulu Structure',
				description: 'Zulu',
				nodes: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'structure-template-source',
				workspace_id: 'owner-1',
				code: 'STR-010',
				name: 'Bravo Structure',
				description: 'Bravo',
				nodes: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getProjectStructureTemplateById.mockResolvedValueOnce({
			id: 'structure-template-1',
			workspace_id: 'owner-1',
			code: 'STR-002',
			name: 'Alpha Structure',
			description: 'Zulu',
			nodes: [],
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await projectStructureTemplatesState.updateTemplate('structure-template-1', {
			code: 'STR-002',
			name: 'Alpha Structure',
			description: 'Zulu',
			is_active: true
		});

		expect(projectStructureTemplatesState.list.map((item) => item.name)).toEqual([
			'Alpha Structure',
			'Bravo Structure'
		]);
		expect(dbServiceMock.getProjectStructureTemplates).not.toHaveBeenCalled();

		dbServiceMock.getProjectStructureTemplateById.mockResolvedValueOnce({
			id: 'structure-template-2',
			workspace_id: 'owner-1',
			code: null,
			name: 'Charlie Structure Copy',
			description: 'Bravo',
			nodes: [],
			is_active: true,
			created_at: '2026-03-09T00:03:00.000Z',
			updated_at: '2026-03-09T00:03:00.000Z'
		});
		await projectStructureTemplatesState.duplicateTemplate('structure-template-source');

		expect(projectStructureTemplatesState.list.map((item) => item.name)).toEqual([
			'Alpha Structure',
			'Bravo Structure',
			'Charlie Structure Copy'
		]);
		expect(dbServiceMock.getProjectStructureTemplates).not.toHaveBeenCalled();

		await projectStructureTemplatesState.deleteTemplate('structure-template-source');

		expect(projectStructureTemplatesState.list.map((item) => item.id)).toEqual([
			'structure-template-1',
			'structure-template-2'
		]);
		expect(dbServiceMock.getProjectStructureTemplates).not.toHaveBeenCalled();
	});

	it('swallows duplicate failures for fire-and-forget admin catalogue actions after routing them through errorState', async () => {
		const { labourRatesState } = await import('./labour-rates.svelte');
		const { equipmentRatesState } = await import('./equipment-rates.svelte');
		const { costComponentPresetsState } = await import('./cost-component-presets.svelte');
		const { estimateTemplatesState } = await import('./estimate-templates.svelte');
		const { projectStructureTemplatesState } = await import('./project-structure-templates.svelte');

		labourRatesState.list = [
			{
				id: 'labour-fail',
				workspace_id: 'owner-1',
				code: 'LAB-001',
				name: 'Labour Fail',
				category: 'Shop',
				work_center: 'A',
				unit: 'hr',
				default_rate: 100,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		equipmentRatesState.list = [
			{
				id: 'equipment-fail',
				workspace_id: 'owner-1',
				code: 'EQ-001',
				name: 'Equipment Fail',
				category: 'Lift',
				work_center: 'Yard',
				unit: 'hr',
				default_rate: 220,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		costComponentPresetsState.list = [
			{
				id: 'preset-fail',
				workspace_id: 'owner-1',
				code: 'PRE-001',
				name: 'Preset Fail',
				description: '',
				components: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		estimateTemplatesState.list = [
			{
				id: 'template-fail',
				workspace_id: 'owner-1',
				code: 'TPL-001',
				name: 'Template Fail',
				description: '',
				estimate: {
					scope_summary: '',
					notes: '',
					takeoff_items: []
				},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		projectStructureTemplatesState.list = [
			{
				id: 'structure-fail',
				workspace_id: 'owner-1',
				code: 'STR-001',
				name: 'Structure Fail',
				description: '',
				nodes: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.addLabourRateCard.mockRejectedValueOnce(new Error('labour duplicate failed'));
		await expect(labourRatesState.duplicateLabourRate('labour-fail')).resolves.toBeUndefined();

		dbServiceMock.addEquipmentRateCard.mockRejectedValueOnce(
			new Error('equipment duplicate failed')
		);
		await expect(
			equipmentRatesState.duplicateEquipmentRate('equipment-fail')
		).resolves.toBeUndefined();

		dbServiceMock.addCostComponentPreset.mockRejectedValueOnce(
			new Error('preset duplicate failed')
		);
		await expect(costComponentPresetsState.duplicatePreset('preset-fail')).resolves.toBeUndefined();

		dbServiceMock.addEstimateTemplate.mockRejectedValueOnce(new Error('template duplicate failed'));
		await expect(
			estimateTemplatesState.duplicateTemplate('template-fail')
		).resolves.toBeUndefined();

		dbServiceMock.addProjectStructureTemplate.mockRejectedValueOnce(
			new Error('structure duplicate failed')
		);
		await expect(
			projectStructureTemplatesState.duplicateTemplate('structure-fail')
		).resolves.toBeUndefined();

		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate labour rate labour-fail'
		);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate equipment rate equipment-fail'
		);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate cost preset preset-fail'
		);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate estimate template template-fail'
		);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate project structure template structure-fail'
		);
	});
});
