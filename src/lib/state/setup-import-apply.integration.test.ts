import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupImportSessionPayload } from '$lib/services/db.js';
import type { ClassificationSystem } from '$lib/types/index.js';

const parseSetupImportFileMock = vi.fn();
const analyseSetupImportWorkbookMock = vi.fn();
const previewSetupImportSheetMock = vi.fn();
const suggestSetupImportSheetForTargetTableMock = vi.fn();

const dbServiceMock = {
	applySetupImportSession: vi.fn(),
	getCostCodes: vi.fn(),
	getContacts: vi.fn(),
	getMaterialCatalogueItems: vi.fn(),
	getLabourRateCards: vi.fn(),
	getEquipmentRateCards: vi.fn(),
	getSubcontractRateCards: vi.fn(),
	getCostComponentPresets: vi.fn(),
	getEstimateTemplates: vi.fn(),
	getClassificationSystems: vi.fn(),
	addMaterialCatalogueItem: vi.fn(),
	getMaterialCatalogueItemById: vi.fn(),
	addContact: vi.fn(),
	getContactById: vi.fn(),
	addSubcontractRateCard: vi.fn(),
	getSubcontractRateCardById: vi.fn(),
	bulkDeleteSubcontractRateCards: vi.fn()
};

const workspaceStateMock = {
	id: 'local-workspace',
	cloudWorkspaceId: '11111111-1111-4111-8111-111111111111'
};

const errorCatchMock = vi.fn();
const toastMock = {
	success: vi.fn()
};

vi.mock('$lib/services/setup-import', () => ({
	SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX: '__setup_import_company__:',
	buildSetupImportPendingContactCompanyKey: (input: {
		country_code?: string;
		business_id_value?: string;
		company_name?: string;
		display_name?: string;
		name?: string;
		email?: string;
	}) => {
		const companySeed =
			input.company_name ||
			input.display_name ||
			input.name ||
			input.business_id_value ||
			input.email ||
			'company';
		const companyKey = companySeed
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '');
		const countryKey = (input.country_code || 'unknown').trim().toLowerCase();
		return `${companyKey}|${countryKey}`;
	},
	buildSetupImportSchemaDigest: () => ({
		digestVersion: 'setup-import-v4',
		tables: [
			{
				id: 'contacts',
				label: 'Companies',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [
					{ id: 'country_code', label: 'Country', required: false, type: 'enum', aliases: [] },
					{ id: 'kind', label: 'Kind', required: false, type: 'enum', aliases: [] },
					{
						id: 'display_name',
						label: 'Display name',
						required: true,
						type: 'string',
						aliases: []
					},
					{ id: 'email', label: 'Email', required: false, type: 'string', aliases: [] }
				]
			},
			{
				id: 'materials',
				label: 'Materials',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [
					{ id: 'code', label: 'Code', required: false, type: 'string', aliases: [] },
					{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] },
					{ id: 'unit', label: 'Unit', required: true, type: 'enum', aliases: [] },
					{
						id: 'default_rate',
						label: 'Default rate',
						required: true,
						type: 'number',
						aliases: []
					},
					{ id: 'is_active', label: 'Active', required: false, type: 'boolean', aliases: [] }
				]
			},
			{
				id: 'labour_rates',
				label: 'Labour Rates',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'equipment_rates',
				label: 'Equipment Rates',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'subcontract_rates',
				label: 'Subcontract Rates',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [
					{ id: 'code', label: 'Code', required: false, type: 'string', aliases: [] },
					{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] },
					{ id: 'unit', label: 'Unit', required: true, type: 'enum', aliases: [] },
					{
						id: 'default_rate',
						label: 'Default rate',
						required: true,
						type: 'number',
						aliases: []
					},
					{ id: 'is_active', label: 'Active', required: false, type: 'boolean', aliases: [] }
				]
			},
			{
				id: 'cost_presets',
				label: 'Cost Presets',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'estimate_templates',
				label: 'Estimate Templates',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'classification_systems',
				label: 'Classification Systems',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'cost_codes',
				label: 'Cost Codes',
				purpose: '',
				exactSheetNames: [],
				sheetNameHints: [],
				excludedFieldIds: [],
				fields: [
					{ id: 'code', label: 'Code', required: true, type: 'string', aliases: [] },
					{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }
				]
			}
		]
	}),
	deriveSetupImportSheetReadiness: (
		table: { id: string; fields: Array<{ id: string; required: boolean }> },
		mappings: Array<{
			targetField: string | null;
			status: string;
			sourceColumn: string;
		}>
	) => {
		const mappedFieldIds = new Set(
			mappings.flatMap((mapping) => (mapping.targetField ? [mapping.targetField] : []))
		);
		const missingRequiredFields = table.fields
			.filter((field) => {
				if (!field.required) return false;
				if (mappedFieldIds.has(field.id)) return false;
				if (table.id !== 'contacts') return true;
				if (field.id === 'kind') {
					return !['display_name', 'name', 'contact_name'].some((fieldId) =>
						mappedFieldIds.has(fieldId)
					);
				}
				if (field.id === 'display_name' || field.id === 'name') {
					return !['display_name', 'name', 'contact_name'].some((fieldId) =>
						mappedFieldIds.has(fieldId)
					);
				}
				return true;
			})
			.map((field) => field.id);
		return {
			readiness:
				missingRequiredFields.length > 0
					? 'blocked'
					: mappings.some((mapping) => mapping.status === 'yellow' || mapping.status === 'red')
						? 'needs_review'
						: 'ready',
			missingRequiredFields,
			unmatchedColumns: mappings
				.filter((mapping) => mapping.status === 'red')
				.map((mapping) => mapping.sourceColumn),
			ignoredColumns: mappings
				.filter((mapping) => mapping.status === 'ignored')
				.map((mapping) => mapping.sourceColumn)
		};
	},
	parseSetupImportFile: parseSetupImportFileMock,
	analyseSetupImportWorkbook: analyseSetupImportWorkbookMock,
	loadSetupImportFileAnalysis: async (input: unknown) => {
		const workbook = await parseSetupImportFileMock(input);
		const analysis = await analyseSetupImportWorkbookMock(workbook);
		return { workbook, analysis };
	},
	previewSetupImportSheet: previewSetupImportSheetMock,
	suggestSetupImportSheetForTargetTable: suggestSetupImportSheetForTargetTableMock
}));

vi.mock('$lib/services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('$lib/state/workspace.svelte', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('$lib/state/errors.svelte', () => ({
	errorState: {
		catchError: errorCatchMock
	}
}));

vi.mock('$lib/utils/env', () => ({
	isTauri: () => false,
	requireInternetConnection: vi.fn()
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

describe('setup import apply integration', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		dbServiceMock.getCostCodes.mockResolvedValue([]);

		const { materialsState } = await import('./materials.svelte');
		const { contactsState } = await import('./contacts.svelte');
		const { subcontractRatesState } = await import('./subcontract-rates.svelte');
		const { classificationSystemsState } = await import('./classification-systems.svelte');
		const { setupImportState } = await import('./setup-import.svelte');

		materialsState.list = [];
		contactsState.list = [];
		subcontractRatesState.list = [];
		classificationSystemsState.list = [];
		setupImportState.clear();

		const persistedContacts: Array<Record<string, unknown>> = [];
		const persistedMaterials: Array<Record<string, unknown>> = [];
		const persistedSubcontractRates: Array<Record<string, unknown>> = [];

		dbServiceMock.getContacts.mockImplementation(async () => persistedContacts);
		dbServiceMock.getMaterialCatalogueItems.mockImplementation(async () => persistedMaterials);
		dbServiceMock.getLabourRateCards.mockResolvedValue([]);
		dbServiceMock.getEquipmentRateCards.mockResolvedValue([]);
		dbServiceMock.getSubcontractRateCards.mockImplementation(async () => persistedSubcontractRates);
		dbServiceMock.getCostComponentPresets.mockResolvedValue([]);
		dbServiceMock.getEstimateTemplates.mockResolvedValue([]);
		dbServiceMock.getClassificationSystems.mockResolvedValue([]);
		dbServiceMock.applySetupImportSession.mockImplementation(
			async (payload: SetupImportSessionPayload) => {
				for (const operation of payload.contacts ?? []) {
					const nextRecord = {
						id: operation.id,
						workspace_id: 'workspace-1',
						sort_order: 0,
						kind: operation.data.kind ?? 'company',
						display_name: operation.data.display_name ?? operation.data.name,
						country_code: operation.data.country_code ?? 'AU',
						name: operation.data.name,
						company_name: operation.data.company_name ?? operation.data.name,
						person_first_name: operation.data.person_first_name ?? '',
						person_last_name: operation.data.person_last_name ?? '',
						role_title: operation.data.role_title ?? '',
						linked_company_id: operation.data.linked_company_id || null,
						is_primary_company_contact: operation.data.is_primary_company_contact ?? false,
						contact_name: operation.data.contact_name ?? '',
						email: operation.data.email ?? '',
						website: operation.data.website ?? '',
						phone: operation.data.phone ?? '',
						phone_country_code:
							operation.data.phone_country_code ?? operation.data.country_code ?? 'AU',
						phone_e164: operation.data.phone_e164 ?? '',
						abn: operation.data.abn ?? '',
						business_id_label: operation.data.business_id_label ?? 'Business ID',
						business_id_value: operation.data.business_id_value ?? '',
						tax_id_label: operation.data.tax_id_label ?? 'Tax ID',
						tax_id_value: operation.data.tax_id_value ?? '',
						address: operation.data.address ?? '',
						notes: operation.data.notes ?? '',
						roles: operation.data.roles ?? ['customer'],
						tags: operation.data.tags ?? [],
						is_active: operation.data.is_active ?? true,
						created_at: '2026-03-24T00:00:00.000Z',
						updated_at: '2026-03-24T00:00:00.000Z'
					};
					const existingIndex = persistedContacts.findIndex((item) => item.id === operation.id);
					if (existingIndex >= 0) persistedContacts[existingIndex] = nextRecord;
					else persistedContacts.push(nextRecord);
				}

				for (const operation of payload.materials ?? []) {
					const nextRecord = {
						id: operation.id,
						workspace_id: 'workspace-1',
						code: operation.data.code ?? '',
						name: operation.data.name,
						category: operation.data.category ?? '',
						specification: operation.data.specification ?? '',
						unit: operation.data.unit,
						default_rate: operation.data.default_rate,
						metadata: {},
						is_active: operation.data.is_active ?? true,
						created_at: '2026-03-24T00:00:00.000Z',
						updated_at: '2026-03-24T00:00:00.000Z'
					};
					const existingIndex = persistedMaterials.findIndex((item) => item.id === operation.id);
					if (existingIndex >= 0) persistedMaterials[existingIndex] = nextRecord;
					else persistedMaterials.push(nextRecord);
				}

				for (const operation of payload.subcontractRates ?? []) {
					const nextRecord = {
						id: operation.id,
						workspace_id: 'workspace-1',
						code: operation.data.code ?? '',
						name: operation.data.name,
						category: operation.data.category ?? '',
						unit: operation.data.unit,
						default_rate: operation.data.default_rate,
						metadata: {},
						is_active: operation.data.is_active ?? true,
						created_at: '2026-03-24T00:00:00.000Z',
						updated_at: '2026-03-24T00:00:00.000Z'
					};
					const existingIndex = persistedSubcontractRates.findIndex(
						(item) => item.id === operation.id
					);
					if (existingIndex >= 0) persistedSubcontractRates[existingIndex] = nextRecord;
					else persistedSubcontractRates.push(nextRecord);
				}
			}
		);

		dbServiceMock.addContact.mockResolvedValue('customer-1');
		dbServiceMock.getContactById.mockResolvedValue({
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
			contact_name: '',
			email: 'estimating@acme.test',
			website: '',
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
			created_at: '2026-03-24T00:00:00.000Z',
			updated_at: '2026-03-24T00:00:00.000Z'
		});
		dbServiceMock.addMaterialCatalogueItem.mockResolvedValue('material-1');
		dbServiceMock.getMaterialCatalogueItemById.mockResolvedValue({
			id: 'material-1',
			workspace_id: 'workspace-1',
			code: 'MAT-001',
			name: 'Plate',
			category: '',
			specification: '',
			unit: 'kg',
			default_rate: 2.85,
			metadata: {},
			is_active: true,
			created_at: '2026-03-24T00:00:00.000Z',
			updated_at: '2026-03-24T00:00:00.000Z'
		});
		dbServiceMock.addSubcontractRateCard.mockResolvedValue('subcontract-1');
		dbServiceMock.getSubcontractRateCardById.mockResolvedValue({
			id: 'subcontract-1',
			workspace_id: 'workspace-1',
			code: 'SUB-001',
			name: 'Scaffold Hire',
			category: 'Access',
			unit: 'day',
			default_rate: 680,
			metadata: {},
			is_active: true,
			created_at: '2026-03-24T00:00:00.000Z',
			updated_at: '2026-03-24T00:00:00.000Z'
		});
	});

	it('creates local records through the typed setup-import session when mapped sheets are imported', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'client_directory',
					sheetName: 'Client Directory',
					headers: ['Client Name', 'Country', 'Email Address'],
					headerIssues: [],
					rowCount: 1,
					rows: [
						{
							'Client Name': 'Acme Fabrication',
							Country: 'AU',
							'Email Address': 'estimating@acme.test'
						}
					],
					sampleRows: [
						{
							'Client Name': 'Acme Fabrication',
							Country: 'AU',
							'Email Address': 'estimating@acme.test'
						}
					]
				},
				{
					sheetId: 'material_master',
					sheetName: 'Material Master',
					headers: ['SKU', 'Material Desc', 'UOM', 'Unit Cost', 'Enabled?'],
					headerIssues: [],
					rowCount: 1,
					rows: [
						{
							SKU: 'MAT-001',
							'Material Desc': 'Plate',
							UOM: 'kg',
							'Unit Cost': '2.85',
							'Enabled?': 'true'
						}
					],
					sampleRows: [
						{
							SKU: 'MAT-001',
							'Material Desc': 'Plate',
							UOM: 'kg',
							'Unit Cost': '2.85',
							'Enabled?': 'true'
						}
					]
				},
				{
					sheetId: 'subcontract_rates',
					sheetName: 'Subcontract Rates',
					headers: ['Subcontract Code', 'Trade', 'Supplier', 'Unit', 'Rate', 'Active'],
					headerIssues: [],
					rowCount: 1,
					rows: [
						{
							'Subcontract Code': 'SUB-001',
							Trade: 'Scaffold Hire',
							Supplier: 'Alpha Access',
							Unit: 'day',
							Rate: '680',
							Active: 'true'
						}
					],
					sampleRows: [
						{
							'Subcontract Code': 'SUB-001',
							Trade: 'Scaffold Hire',
							Supplier: 'Alpha Access',
							Unit: 'day',
							Rate: '680',
							Active: 'true'
						}
					]
				}
			]
		});

		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 2,
				ignoredSheetCount: 0,
				reviewPriority: []
			},
			sheets: [
				{
					sheetId: 'client_directory',
					sheetName: 'Client Directory',
					targetTable: 'contacts',
					readiness: 'ready',
					summary: 'Companies',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Client Name',
							targetField: 'display_name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Client Name',
							targetField: 'kind',
							status: 'green',
							confidence: 'high',
							reason: 'Treat sheet as companies'
						},
						{
							sourceColumn: 'Country',
							targetField: 'country_code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Email Address',
							targetField: 'email',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				},
				{
					sheetId: 'material_master',
					sheetName: 'Material Master',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'SKU',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Material Desc',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'UOM',
							targetField: 'unit',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Unit Cost',
							targetField: 'default_rate',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Enabled?',
							targetField: 'is_active',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				},
				{
					sheetId: 'subcontract_rates',
					sheetName: 'Subcontract Rates',
					targetTable: 'subcontract_rates',
					readiness: 'ready',
					summary: 'Subcontract Rates',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Subcontract Code',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Trade',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Unit',
							targetField: 'unit',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Rate',
							targetField: 'default_rate',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Active',
							targetField: 'is_active',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});

		previewSetupImportSheetMock.mockImplementation((workbookSheet, sheet) => {
			if (sheet.targetTable === 'contacts') {
				return {
					validRows: [
						{
							kind: 'company',
							display_name: 'Acme Fabrication',
							country_code: 'AU',
							name: 'Acme Fabrication',
							company_name: 'Acme Fabrication',
							contact_name: '',
							email: 'estimating@acme.test',
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
							role_title: '',
							linked_company_id: '',
							is_primary_company_contact: false,
							roles: ['customer'],
							tags: [],
							is_active: true
						}
					],
					errors: [],
					blocked: false
				};
			}

			if (sheet.targetTable === 'materials') {
				return {
					validRows: [
						{
							code: 'MAT-001',
							name: 'Plate',
							category: '',
							specification: '',
							unit: 'kg',
							default_rate: 2.85,
							is_active: true
						}
					],
					errors: [],
					blocked: false
				};
			}

			if (sheet.targetTable === 'subcontract_rates') {
				return {
					validRows: [
						{
							code: 'SUB-001',
							name: 'Scaffold Hire',
							category: 'Access',
							unit: 'day',
							default_rate: 680,
							is_active: true
						}
					],
					errors: [],
					blocked: false
				};
			}

			return { validRows: [], errors: [], blocked: false };
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');
		const { contactsState } = await import('./contacts.svelte');
		const { materialsState } = await import('./materials.svelte');
		const { subcontractRatesState } = await import('./subcontract-rates.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		await setupImportState.applyImport();

		expect(contactsState.list.map((contact) => contact.name)).toEqual(['Acme Fabrication']);
		expect(materialsState.list.map((material) => material.name)).toEqual(['Plate']);
		expect(subcontractRatesState.list.map((rate) => rate.name)).toEqual(['Scaffold Hire']);
		expect(dbServiceMock.applySetupImportSession).toHaveBeenCalledTimes(1);
	});

	it('blocks importing a different default classification system when one already exists', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'classifications.csv',
			fileExtension: 'csv',
			sheets: [
				{
					sheetId: 'classification_systems',
					sheetName: 'Classification Systems',
					headers: ['Name', 'Default'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ Name: 'Workshop Codes', Default: 'true' }],
					sampleRows: [{ Name: 'Workshop Codes', Default: 'true' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: { importableSheetCount: 1, ignoredSheetCount: 0, reviewPriority: [] },
			sheets: [
				{
					sheetId: 'classification_systems',
					sheetName: 'Classification Systems',
					targetTable: 'classification_systems',
					readiness: 'ready',
					summary: 'Classification Systems',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'Default',
							targetField: 'is_default',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [
				{
					name: 'Workshop Codes',
					code: '',
					type: 'custom',
					aliases: [],
					is_default: true
				}
			],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { classificationSystemsState } = await import('./classification-systems.svelte');
		const existingClassificationSystems: ClassificationSystem[] = [
			{
				id: 'system-existing',
				workspace_id: 'workspace-1',
				name: 'MasterFormat',
				code: 'MF',
				classification_type: 'masterformat',
				aliases: [],
				is_default: true,
				created_at: '2026-03-24T00:00:00.000Z'
			}
		];
		classificationSystemsState.list = existingClassificationSystems;
		dbServiceMock.getClassificationSystems.mockResolvedValue(existingClassificationSystems);
		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'classifications.csv',
			sourcePath: '/tmp/classifications.csv',
			bytes: new Uint8Array([1, 2, 3])
		});

		const preflight = setupImportState.getImportPreflight();
		expect(preflight.canApply).toBe(false);
		expect(preflight.dependencyErrors[0]?.message).toContain(
			'already has default classification system'
		);
		expect(dbServiceMock.applySetupImportSession).not.toHaveBeenCalled();
	});

	it('resolves pending company links when importing expanded contact rows', async () => {
		const { contactsState } = await import('./contacts.svelte');
		const { SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX } =
			await import('$lib/services/setup-import');

		dbServiceMock.getContactById
			.mockImplementationOnce(async (id: string) => ({
				id,
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
				contact_name: 'Mia Collins',
				email: 'estimating@acme.test',
				website: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'Business ID',
				business_id_value: 'CUST-001',
				tax_id_label: 'Tax ID',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				sort_order: 0,
				created_at: '2026-03-24T00:00:00.000Z',
				updated_at: '2026-03-24T00:00:00.000Z'
			}))
			.mockImplementationOnce(async (id: string) => ({
				id,
				workspace_id: 'workspace-1',
				kind: 'person',
				display_name: 'Mia Collins',
				country_code: 'AU',
				name: 'Mia Collins',
				company_name: 'Acme Fabrication',
				person_first_name: 'Mia',
				person_last_name: 'Collins',
				role_title: '',
				linked_company_id: dbServiceMock.addContact.mock.calls[0]?.[0] ?? '',
				is_primary_company_contact: true,
				contact_name: '',
				email: 'mia.collins@acme.test',
				website: '',
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
				sort_order: 1,
				created_at: '2026-03-24T00:00:00.000Z',
				updated_at: '2026-03-24T00:00:00.000Z'
			}));

		await contactsState.importContacts([
			{
				kind: 'company',
				country_code: 'AU',
				display_name: 'Acme Fabrication',
				name: 'Acme Fabrication',
				company_name: 'Acme Fabrication',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: '',
				is_primary_company_contact: false,
				contact_name: 'Mia Collins',
				email: 'estimating@acme.test',
				website: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'Business ID',
				business_id_value: 'CUST-001',
				tax_id_label: 'Tax ID',
				tax_id_value: '',
				address: '',
				notes: '',
				custom_role_label: '',
				roles: ['customer'],
				tags: [],
				is_active: true
			},
			{
				kind: 'person',
				country_code: 'AU',
				display_name: 'Mia Collins',
				name: 'Mia Collins',
				company_name: 'Acme Fabrication',
				person_first_name: 'Mia',
				person_last_name: 'Collins',
				role_title: '',
				linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}acme_fabrication|au`,
				is_primary_company_contact: true,
				contact_name: '',
				email: 'mia.collins@acme.test',
				website: '',
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
				custom_role_label: '',
				roles: ['customer'],
				tags: [],
				is_active: true
			}
		]);

		const companyInsertId = dbServiceMock.addContact.mock.calls[0]?.[0];
		expect(dbServiceMock.addContact).toHaveBeenCalledTimes(2);
		expect(dbServiceMock.addContact).toHaveBeenNthCalledWith(
			2,
			expect.any(String),
			expect.objectContaining({
				kind: 'person',
				linked_company_id: companyInsertId
			})
		);
		expect(contactsState.list).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: companyInsertId, kind: 'company' }),
				expect.objectContaining({
					id: expect.any(String),
					kind: 'person',
					linked_company_id: companyInsertId
				})
			])
		);
	});
});
