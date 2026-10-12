import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactFormValues } from '$lib/schemas/index.js';

function buildContactFormValues(
	overrides: Partial<ContactFormValues> & Pick<ContactFormValues, 'name'>
): ContactFormValues {
	return {
		country_code: overrides.country_code ?? 'AU',
		name: overrides.name,
		kind: overrides.kind ?? 'company',
		display_name: overrides.display_name ?? overrides.name,
		company_name: overrides.company_name ?? overrides.name,
		person_first_name: overrides.person_first_name ?? '',
		person_last_name: overrides.person_last_name ?? '',
		role_title: overrides.role_title ?? '',
		linked_company_id: overrides.linked_company_id ?? '',
		is_primary_company_contact: overrides.is_primary_company_contact ?? false,
		contact_name: overrides.contact_name ?? '',
		email: overrides.email ?? '',
		website: overrides.website ?? '',
		phone: overrides.phone ?? '',
		phone_country_code: overrides.phone_country_code ?? 'AU',
		phone_e164: overrides.phone_e164 ?? '',
		abn: overrides.abn ?? '',
		business_id_label: overrides.business_id_label ?? 'Business ID',
		business_id_value: overrides.business_id_value ?? '',
		tax_id_label: overrides.tax_id_label ?? 'Tax ID',
		tax_id_value: overrides.tax_id_value ?? '',
		address: overrides.address ?? '',
		notes: overrides.notes ?? '',
		custom_role_label: overrides.custom_role_label ?? '',
		roles: overrides.roles ?? ['customer'],
		tags: overrides.tags ?? [],
		is_active: overrides.is_active ?? true
	};
}

const dbServiceMock = {
	addMaterialCatalogueItem: vi.fn(),
	updateMaterialCatalogueItem: vi.fn(),
	getMaterialCatalogueItemById: vi.fn(),
	getMaterialCatalogueItems: vi.fn(),
	addLabourRateCard: vi.fn(),
	updateLabourRateCard: vi.fn(),
	getLabourRateCardById: vi.fn(),
	getLabourRateCards: vi.fn(),
	addEquipmentRateCard: vi.fn(),
	updateEquipmentRateCard: vi.fn(),
	getEquipmentRateCardById: vi.fn(),
	getEquipmentRateCards: vi.fn(),
	addSubcontractRateCard: vi.fn(),
	updateSubcontractRateCard: vi.fn(),
	getSubcontractRateCardById: vi.fn(),
	getSubcontractRateCards: vi.fn(),
	addContact: vi.fn(),
	updateContact: vi.fn(),
	getContactById: vi.fn(),
	getContacts: vi.fn(),
	addCostComponentPreset: vi.fn(),
	updateCostComponentPreset: vi.fn(),
	getCostComponentPresetById: vi.fn(),
	getCostComponentPresets: vi.fn(),
	addEstimateTemplate: vi.fn(),
	updateEstimateTemplate: vi.fn(),
	getEstimateTemplateById: vi.fn(),
	getEstimateTemplates: vi.fn(),
	addClassificationSystem: vi.fn(),
	updateClassificationSystem: vi.fn(),
	getClassificationSystemById: vi.fn(),
	getClassificationSystems: vi.fn(),
	addCostCode: vi.fn(),
	updateCostCode: vi.fn(),
	getCostCodeById: vi.fn(),
	getCostCodes: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const toastMock = {
	success: vi.fn()
};

const invokeMock = vi.fn();

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('../utils/env', () => ({
	isTauri: () => false
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

describe('admin catalogue imports', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('imports setup-library data with narrow in-place reconciliation', async () => {
		const { materialsState } = await import('./materials.svelte');
		const { labourRatesState } = await import('./labour-rates.svelte');
		const { equipmentRatesState } = await import('./equipment-rates.svelte');
		const { subcontractRatesState } = await import('./subcontract-rates.svelte');
		const { contactsState } = await import('./contacts.svelte');
		const { costComponentPresetsState } = await import('./cost-component-presets.svelte');
		const { estimateTemplatesState } = await import('./estimate-templates.svelte');
		const { classificationSystemsState } = await import('./classification-systems.svelte');

		materialsState.list = [];
		labourRatesState.list = [];
		equipmentRatesState.list = [];
		subcontractRatesState.list = [];
		contactsState.list = [];
		costComponentPresetsState.list = [];
		estimateTemplatesState.list = [];
		classificationSystemsState.list = [];
		classificationSystemsState.costCodes = [];

		dbServiceMock.getMaterialCatalogueItemById.mockResolvedValueOnce({
			id: 'material-1',
			code: 'MAT-001',
			name: 'Alpha Plate',
			category: 'Steel Plate',
			specification: 'AS/NZS 3678',
			unit: 'kg',
			default_rate: 2.85,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getLabourRateCardById.mockResolvedValueOnce({
			id: 'labour-1',
			code: 'LAB-001',
			name: 'Alpha Labour',
			category: 'Fabrication',
			work_center: 'Laser Cell',
			unit: 'hr',
			default_rate: 110,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getEquipmentRateCardById.mockResolvedValueOnce({
			id: 'equipment-1',
			code: 'EQ-001',
			name: 'Alpha Machine',
			category: 'Fabrication',
			work_center: 'Workshop',
			unit: 'hr',
			default_rate: 165,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getSubcontractRateCardById.mockResolvedValueOnce({
			id: 'subcontract-1',
			workspace_id: 'workspace-1',
			code: 'SUB-001',
			name: 'Scaffold Crew',
			category: 'Access',
			unit: 'day',
			default_rate: 680,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'customer-1',
			workspace_id: 'workspace-1',
			kind: 'company',
			display_name: 'Acme Fabrication',
			country_code: 'AU',
			name: 'Acme Fabrication',
			company_name: 'Acme Fabrication',
			person_first_name: '',
			person_last_name: '',
			role_title: '',
			linked_company_id: null,
			is_primary_company_contact: false,
			contact_name: 'Sam',
			email: 'sam@acme.test',
			phone: '',
			phone_country_code: 'AU',
			phone_e164: '',
			abn: '',
			business_id_label: 'Business ID',
			business_id_value: '',
			tax_id_label: 'Tax ID',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: true,
			sort_order: 0,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getCostComponentPresetById.mockResolvedValueOnce({
			id: 'preset-1',
			workspace_id: 'workspace-1',
			code: 'PRE-001',
			name: 'Fabrication Pack',
			description: 'Default fabrication preset',
			components: [],
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getEstimateTemplateById.mockResolvedValueOnce({
			id: 'template-1',
			workspace_id: 'workspace-1',
			code: 'TPL-001',
			name: 'Starter Template',
			description: 'Starter scope',
			estimate: { scope_summary: '', notes: '', takeoff_items: [] },
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getClassificationSystemById.mockResolvedValueOnce({
			id: 'system-1',
			workspace_id: 'workspace-1',
			name: 'MasterFormat',
			code: 'MF',
			classification_type: 'masterformat',
			aliases: [],
			is_default: true,
			created_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getCostCodeById.mockResolvedValueOnce({
			id: 'cost-code-1',
			classification_system_id: 'system-1',
			parent_id: null,
			code: '03-3000',
			name: 'Cast-in-Place Concrete',
			description: '',
			is_active: true,
			sort_order: 0,
			created_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getCostCodes.mockResolvedValue([
			{
				id: 'cost-code-0',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '01-0000',
				name: 'Existing Root',
				description: '',
				is_active: true,
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		await materialsState.importMaterials([
			{
				code: 'MAT-001',
				name: 'Alpha Plate',
				aliases: [],
				category: 'Steel Plate',
				specification: 'AS/NZS 3678',
				unit: 'kg',
				default_rate: 2.85,
				is_active: true
			}
		]);
		await labourRatesState.importLabourRates([
			{
				code: 'LAB-001',
				name: 'Alpha Labour',
				aliases: [],
				category: 'Fabrication',
				work_center: 'Laser Cell',
				unit: 'hr',
				default_rate: 110,
				is_active: true
			}
		]);
		await equipmentRatesState.importEquipmentRates([
			{
				code: 'EQ-001',
				name: 'Alpha Machine',
				aliases: [],
				category: 'Fabrication',
				work_center: 'Workshop',
				unit: 'hr',
				default_rate: 165,
				is_active: true
			}
		]);
		await subcontractRatesState.importSubcontractRates([
			{
				code: 'SUB-001',
				name: 'Scaffold Crew',
				aliases: [],
				category: 'Access',
				unit: 'day',
				default_rate: 680,
				is_active: true
			}
		]);
		await contactsState.importContacts([
			buildContactFormValues({
				name: 'Acme Fabrication',
				contact_name: 'Sam',
				email: 'sam@acme.test'
			})
		]);
		await costComponentPresetsState.importCostComponentPresets([
			{
				code: 'PRE-001',
				name: 'Fabrication Pack',
				description: 'Default fabrication preset',
				aliases: [],
				is_active: true
			}
		]);
		await estimateTemplatesState.importEstimateTemplates([
			{
				code: 'TPL-001',
				name: 'Starter Template',
				description: 'Starter scope',
				aliases: [],
				is_active: true
			}
		]);
		await classificationSystemsState.importClassificationSystems([
			{
				name: 'MasterFormat',
				code: 'MF',
				classification_type: 'masterformat',
				aliases: [],
				is_default: true
			}
		]);
		await classificationSystemsState.importCostCodes('system-1', [
			{
				parent_id: null,
				code: '03-3000',
				name: 'Cast-in-Place Concrete',
				description: '',
				is_active: true,
				sort_order: 0
			}
		]);

		expect(materialsState.list.map((item) => item.name)).toEqual(['Alpha Plate']);
		expect(labourRatesState.list.map((item) => item.name)).toEqual(['Alpha Labour']);
		expect(equipmentRatesState.list.map((item) => item.name)).toEqual(['Alpha Machine']);
		expect(subcontractRatesState.list.map((item) => item.name)).toEqual(['Scaffold Crew']);
		expect(contactsState.list.map((item) => item.name)).toEqual(['Acme Fabrication']);
		expect(costComponentPresetsState.list.map((item) => item.name)).toEqual(['Fabrication Pack']);
		expect(estimateTemplatesState.list.map((item) => item.name)).toEqual(['Starter Template']);
		expect(classificationSystemsState.list.map((item) => item.name)).toEqual(['MasterFormat']);
		expect(classificationSystemsState.costCodes.map((item) => item.code)).toEqual(['03-3000']);
		expect(dbServiceMock.getMaterialCatalogueItems).not.toHaveBeenCalled();
		expect(dbServiceMock.getLabourRateCards).not.toHaveBeenCalled();
		expect(dbServiceMock.getEquipmentRateCards).not.toHaveBeenCalled();
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();
		expect(dbServiceMock.getCostComponentPresets).not.toHaveBeenCalled();
		expect(dbServiceMock.getEstimateTemplates).not.toHaveBeenCalled();
		expect(dbServiceMock.getClassificationSystems).not.toHaveBeenCalled();
		expect(dbServiceMock.getCostCodes).toHaveBeenCalledWith('system-1', true);
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 material');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 labour rate');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 equipment rate');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 subcontract rate');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 company/contact record');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 cost preset');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 estimate template');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 classification system');
		expect(toastMock.success).toHaveBeenCalledWith('Imported 1 cost code');
	});

	it('keeps existing matches by default and updates matched rows when requested', async () => {
		const { materialsState } = await import('./materials.svelte');
		const { contactsState } = await import('./contacts.svelte');
		const { classificationSystemsState } = await import('./classification-systems.svelte');

		materialsState.list = [
			{
				id: 'material-1',
				workspace_id: 'workspace-1',
				code: 'MAT-001',
				name: 'Alpha Plate',
				category: '',
				specification: '',
				unit: 'kg',
				default_rate: 2.5,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		contactsState.list = [
			{
				id: 'customer-1',
				workspace_id: 'workspace-1',
				country_code: 'AU',
				name: 'Acme Fabrication',
				contact_name: 'Sam',
				email: 'sam@acme.test',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'Business ID',
				business_id_value: '',
				tax_id_label: 'Tax ID',
				tax_id_value: '',
				address: '',
				notes: '',
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		classificationSystemsState.list = [
			{
				id: 'system-1',
				workspace_id: 'workspace-1',
				name: 'MasterFormat',
				code: 'MF',
				classification_type: 'masterformat',
				aliases: [],
				is_default: true,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];
		classificationSystemsState.costCodes = [
			{
				id: 'cost-code-1',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '03-3000',
				name: 'Old Concrete',
				description: '',
				is_active: true,
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		];
		classificationSystemsState.activeSystemId = 'system-1';

		dbServiceMock.getMaterialCatalogueItemById.mockResolvedValueOnce({
			id: 'material-1',
			code: 'MAT-001',
			name: 'Alpha Plate',
			category: '',
			specification: '',
			unit: 'kg',
			default_rate: 3.1,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-10T00:00:00.000Z'
		});
		dbServiceMock.getCostCodes.mockResolvedValue([
			{
				id: 'cost-code-1',
				classification_system_id: 'system-1',
				parent_id: null,
				code: '03-3000',
				name: 'Old Concrete',
				description: '',
				is_active: true,
				sort_order: 0,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);
		dbServiceMock.getCostCodeById.mockResolvedValueOnce({
			id: 'cost-code-1',
			classification_system_id: 'system-1',
			parent_id: null,
			code: '03-3000',
			name: 'Cast-in-Place Concrete',
			description: '',
			is_active: true,
			sort_order: 0,
			created_at: '2026-03-09T00:00:00.000Z'
		});

		await contactsState.importContacts(
			[
				buildContactFormValues({
					name: 'Acme Fabrication',
					contact_name: 'Sam',
					email: 'sam@acme.test'
				})
			],
			'keep_existing'
		);
		await materialsState.importMaterials(
			[
				{
					code: 'MAT-001',
					name: 'Alpha Plate',
					aliases: [],
					category: '',
					specification: '',
					unit: 'kg',
					default_rate: 3.1,
					is_active: true
				}
			],
			'update_matched'
		);
		const importedSystems = await classificationSystemsState.importClassificationSystems(
			[
				{
					name: 'MasterFormat',
					code: 'MF',
					classification_type: 'masterformat',
					aliases: [],
					is_default: true
				}
			],
			'keep_existing'
		);
		await classificationSystemsState.importCostCodes(
			'system-1',
			[
				{
					parent_id: null,
					code: '03-3000',
					name: 'Cast-in-Place Concrete',
					description: '',
					is_active: true,
					sort_order: 0
				}
			],
			'update_matched'
		);

		expect(dbServiceMock.addContact).not.toHaveBeenCalled();
		expect(dbServiceMock.updateMaterialCatalogueItem).toHaveBeenCalledWith('material-1', {
			code: 'MAT-001',
			name: 'Alpha Plate',
			aliases: [],
			category: '',
			specification: '',
			unit: 'kg',
			default_rate: 3.1,
			is_active: true
		});
		expect(importedSystems).toEqual([
			expect.objectContaining({
				id: 'system-1',
				name: 'MasterFormat'
			})
		]);
		expect(dbServiceMock.updateCostCode).toHaveBeenCalledWith('cost-code-1', {
			parent_id: null,
			code: '03-3000',
			name: 'Cast-in-Place Concrete',
			description: '',
			is_active: true,
			sort_order: 0
		});
		expect(toastMock.success).toHaveBeenCalledWith('Company import complete: 1 kept existing');
		expect(toastMock.success).toHaveBeenCalledWith('Material import complete: 1 updated');
		expect(toastMock.success).toHaveBeenCalledWith(
			'Classification system import complete: 1 kept existing'
		);
		expect(toastMock.success).toHaveBeenCalledWith('Cost code import complete: 1 updated');
	});

	it('imports preset and template payloads when setup import provides them', async () => {
		const { costComponentPresetsState } = await import('./cost-component-presets.svelte');
		const { estimateTemplatesState } = await import('./estimate-templates.svelte');

		dbServiceMock.getCostComponentPresetById.mockResolvedValueOnce({
			id: 'preset-1',
			workspace_id: 'workspace-1',
			code: 'PRE-001',
			name: 'Fabrication Pack',
			description: 'Preset',
			components: [
				{
					category: 'labour',
					source_type: 'manual',
					name: 'Workshop Labour',
					description: '',
					quantity: 1,
					unit: 'hr',
					unit_rate: 95,
					formula: {},
					metadata: {},
					sort_order: 0
				}
			],
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});
		dbServiceMock.getEstimateTemplateById.mockResolvedValueOnce({
			id: 'template-1',
			workspace_id: 'workspace-1',
			code: 'TPL-001',
			name: 'Starter Template',
			description: 'Template',
			estimate: {
				scope_summary: 'Starter scope',
				notes: 'Imported template',
				takeoff_items: []
			},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:00:00.000Z'
		});

		await costComponentPresetsState.importCostComponentPresets([
			{
				code: 'PRE-001',
				name: 'Fabrication Pack',
				description: 'Preset',
				aliases: [],
				is_active: true,
				components_json: [
					{
						category: 'labour',
						source_type: 'manual',
						name: 'Workshop Labour',
						description: '',
						quantity: 1,
						unit: 'hr',
						unit_rate: 95,
						formula: {},
						metadata: {},
						sort_order: 0
					}
				]
			}
		]);

		await estimateTemplatesState.importEstimateTemplates([
			{
				code: 'TPL-001',
				name: 'Starter Template',
				description: 'Template',
				aliases: [],
				is_active: true,
				estimate_json: {
					scope_summary: 'Starter scope',
					notes: 'Imported template',
					takeoff_items: []
				}
			}
		]);

		expect(dbServiceMock.addCostComponentPreset).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ name: 'Fabrication Pack' }),
			[
				expect.objectContaining({
					category: 'labour',
					name: 'Workshop Labour'
				})
			]
		);
		expect(dbServiceMock.addEstimateTemplate).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ name: 'Starter Template' }),
			expect.objectContaining({
				scope_summary: 'Starter scope',
				notes: 'Imported template'
			})
		);
	});

	it('preserves existing preset and template payloads when setup import does not map them', async () => {
		const { costComponentPresetsState } = await import('./cost-component-presets.svelte');
		const { estimateTemplatesState } = await import('./estimate-templates.svelte');

		costComponentPresetsState.list = [
			{
				id: 'preset-1',
				workspace_id: 'workspace-1',
				code: 'PRE-001',
				name: 'Fabrication Pack',
				description: 'Old preset',
				components: [
					{
						category: 'labour',
						source_type: 'manual',
						name: 'Existing Labour',
						description: '',
						quantity: 1,
						unit: 'hr',
						unit_rate: 88,
						formula: {},
						metadata: {},
						sort_order: 0
					}
				],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		estimateTemplatesState.list = [
			{
				id: 'template-1',
				workspace_id: 'workspace-1',
				code: 'TPL-001',
				name: 'Starter Template',
				description: 'Old template',
				estimate: {
					scope_summary: 'Existing scope',
					notes: 'Existing notes',
					takeoff_items: []
				},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		dbServiceMock.getCostComponentPresetById.mockResolvedValueOnce(
			costComponentPresetsState.list[0]
		);
		dbServiceMock.getEstimateTemplateById.mockResolvedValueOnce(estimateTemplatesState.list[0]);

		await costComponentPresetsState.importCostComponentPresets(
			[
				{
					code: 'PRE-001',
					name: 'Fabrication Pack',
					description: 'Updated preset',
					aliases: [],
					is_active: true
				}
			],
			'update_matched'
		);

		await estimateTemplatesState.importEstimateTemplates(
			[
				{
					code: 'TPL-001',
					name: 'Starter Template',
					description: 'Updated template',
					aliases: [],
					is_active: true
				}
			],
			'update_matched'
		);

		expect(dbServiceMock.updateCostComponentPreset).toHaveBeenCalledWith(
			'preset-1',
			expect.objectContaining({ description: 'Updated preset' }),
			[
				expect.objectContaining({
					name: 'Existing Labour',
					unit_rate: 88
				})
			]
		);
		expect(dbServiceMock.updateEstimateTemplate).toHaveBeenCalledWith(
			'template-1',
			expect.objectContaining({ description: 'Updated template' }),
			expect.objectContaining({
				scope_summary: 'Existing scope',
				notes: 'Existing notes'
			})
		);
	});
});
