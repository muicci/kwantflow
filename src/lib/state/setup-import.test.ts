import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupImportAnalysis, SetupImportWorkbook } from '$lib/services/setup-import.js';

const parseSetupImportFileMock = vi.fn();
const analyseSetupImportWorkbookMock = vi.fn();
const previewSetupImportSheetMock = vi.fn();
const suggestSetupImportSheetForTargetTableMock = vi.fn();
const applySetupImportSessionMock = vi.fn();
const getCostCodesMock = vi.fn();
const contactsImportMock = vi.fn();
const materialsImportMock = vi.fn();
const labourRatesImportMock = vi.fn();
const equipmentRatesImportMock = vi.fn();
const subcontractRatesImportMock = vi.fn();
const costPresetsImportMock = vi.fn();
const estimateTemplatesImportMock = vi.fn();
const classificationSystemsImportMock = vi.fn();
const costCodesHierarchyImportMock = vi.fn();
const classificationSystemsHydrateMock = vi.fn();
const errorCatchMock = vi.fn();
const workspaceStateMock = {
	id: 'local-workspace',
	countryCode: 'AU'
};

function prepareReadyMaterialWorkbook(fileName = 'materials.csv'): SetupImportWorkbook {
	const row = { Name: 'Synthetic Plate' };
	const workbook: SetupImportWorkbook = {
		fileName,
		fileExtension: 'csv',
		sheets: [
			{
				sheetId: 'materials',
				sheetName: 'Materials',
				headers: ['Name'],
				headerIssues: [],
				rowCount: 1,
				rows: [row],
				sampleRows: [row]
			}
		]
	};
	const analysis: SetupImportAnalysis = {
		workbookSummary: {
			importableSheetCount: 1,
			ignoredSheetCount: 0,
			reviewPriority: ['materials']
		},
		sheets: [
			{
				sheetId: 'materials',
				sheetName: 'Materials',
				targetTable: 'materials',
				readiness: 'ready',
				summary: 'One valid material',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'Name',
						targetField: 'name',
						status: 'green',
						confidence: 'high',
						reason: 'Exact field match'
					}
				]
			}
		]
	};
	parseSetupImportFileMock.mockResolvedValue(workbook);
	analyseSetupImportWorkbookMock.mockResolvedValue(analysis);
	previewSetupImportSheetMock.mockReturnValue({
		validRows: [
			{
				name: 'Synthetic Plate',
				code: '',
				category: '',
				specification: '',
				unit: 'kg',
				default_rate: 2.85,
				is_active: true
			}
		],
		errors: [],
		blocked: false
	});
	return workbook;
}

function normaliseMockCostCodeLookupValue(value: string | null | undefined): string {
	return (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function analyseCostCodeHierarchyMock<T extends { code: string; parent_id?: string | null }>(
	rows: T[],
	options: { existingCodes?: Array<{ code: string }> } = {}
) {
	const availableCodes = new Set(
		(options.existingCodes ?? []).map((item) => normaliseMockCostCodeLookupValue(item.code))
	);
	const pendingSheetCodes = new Set(rows.map((row) => normaliseMockCostCodeLookupValue(row.code)));
	const pendingRows = rows.map((row, rowIndex) => ({
		row,
		rowIndex,
		normalizedCode: normaliseMockCostCodeLookupValue(row.code),
		normalizedParentRef: normaliseMockCostCodeLookupValue(row.parent_id),
		sourceParentRef: row.parent_id?.trim() || null
	}));
	const orderedRows: Array<{ row: T; rowIndex: number }> = [];
	const issues: Array<{ rowIndex: number; message: string }> = [];

	while (pendingRows.length > 0) {
		let progressed = false;
		for (let index = 0; index < pendingRows.length; index += 1) {
			const candidate = pendingRows[index];
			if (
				candidate.sourceParentRef &&
				!availableCodes.has(candidate.normalizedParentRef) &&
				!pendingSheetCodes.has(candidate.normalizedParentRef)
			) {
				issues.push({
					rowIndex: candidate.rowIndex,
					message: `Parent cost code "${candidate.sourceParentRef}" must exist in this sheet or in the selected classification system.`
				});
				pendingSheetCodes.delete(candidate.normalizedCode);
				pendingRows.splice(index, 1);
				index -= 1;
				progressed = true;
				continue;
			}

			if (!candidate.sourceParentRef || availableCodes.has(candidate.normalizedParentRef)) {
				orderedRows.push({ row: candidate.row, rowIndex: candidate.rowIndex });
				availableCodes.add(candidate.normalizedCode);
				pendingSheetCodes.delete(candidate.normalizedCode);
				pendingRows.splice(index, 1);
				index -= 1;
				progressed = true;
			}
		}

		if (progressed) continue;

		for (const candidate of pendingRows) {
			issues.push({
				rowIndex: candidate.rowIndex,
				message: 'Cost codes contain a circular parent relationship.'
			});
		}
		break;
	}

	return { orderedRows, issues };
}

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
				fields: [
					{ id: 'kind', label: 'Kind', required: false, type: 'enum', aliases: [] },
					{
						id: 'display_name',
						label: 'Display name',
						required: true,
						type: 'string',
						aliases: []
					},
					{ id: 'name', label: 'Name', required: false, type: 'string', aliases: [] },
					{
						id: 'person_name',
						label: 'Primary contact',
						required: false,
						type: 'string',
						aliases: []
					},
					{
						id: 'country_code',
						label: 'Country',
						required: false,
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
				fields: [
					{ id: 'code', label: 'Code', required: false, type: 'string', aliases: [] },
					{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }
				]
			},
			{
				id: 'labour_rates',
				label: 'Labour Rates',
				purpose: '',
				fields: [
					{ id: 'code', label: 'Code', required: false, type: 'string', aliases: [] },
					{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] },
					{ id: 'unit', label: 'Unit', required: true, type: 'enum', aliases: [] }
				]
			},
			{
				id: 'equipment_rates',
				label: 'Equipment Rates',
				purpose: '',
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'cost_presets',
				label: 'Cost Presets',
				purpose: '',
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'estimate_templates',
				label: 'Estimate Templates',
				purpose: '',
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'classification_systems',
				label: 'Classification Systems',
				purpose: '',
				fields: [{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }]
			},
			{
				id: 'cost_codes',
				label: 'Cost Codes',
				purpose: '',
				fields: [
					{ id: 'code', label: 'Code', required: true, type: 'string', aliases: [] },
					{ id: 'name', label: 'Name', required: true, type: 'string', aliases: [] }
				]
			}
		]
	}),
	deriveSetupImportSheetReadiness: (
		table: { id: string; fields: Array<{ id: string; required: boolean }> },
		mappings: Array<{ targetField: string | null; status: string; sourceColumn: string }>
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
	analyseCostCodeHierarchy: analyseCostCodeHierarchyMock,
	previewSetupImportSheet: previewSetupImportSheetMock,
	suggestSetupImportSheetForTargetTable: suggestSetupImportSheetForTargetTableMock
}));

vi.mock('$lib/state/workspace.svelte', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('$lib/state/errors.svelte', () => ({
	errorState: {
		catchError: errorCatchMock
	}
}));

vi.mock('$lib/utils/env.js', () => ({
	requireInternetConnection: vi.fn(),
	isTauri: () => false
}));

vi.mock('$lib/state/contacts.svelte', () => ({
	contactsState: {
		list: [],
		refresh: vi.fn(),
		importContacts: contactsImportMock,
		findMatchingContact: vi.fn(() => null)
	}
}));

vi.mock('$lib/state/materials.svelte', () => ({
	materialsState: {
		list: [],
		refresh: vi.fn(),
		importMaterials: materialsImportMock
	}
}));

vi.mock('$lib/state/labour-rates.svelte', () => ({
	labourRatesState: {
		list: [],
		refresh: vi.fn(),
		importLabourRates: labourRatesImportMock
	}
}));

vi.mock('$lib/state/equipment-rates.svelte', () => ({
	equipmentRatesState: {
		list: [],
		refresh: vi.fn(),
		importEquipmentRates: equipmentRatesImportMock
	}
}));

vi.mock('$lib/state/subcontract-rates.svelte', () => ({
	subcontractRatesState: {
		list: [],
		refresh: vi.fn(),
		importSubcontractRates: subcontractRatesImportMock
	}
}));

vi.mock('$lib/state/cost-component-presets.svelte', () => ({
	costComponentPresetsState: {
		list: [],
		refresh: vi.fn(),
		importCostComponentPresets: costPresetsImportMock
	}
}));

vi.mock('$lib/state/estimate-templates.svelte', () => ({
	estimateTemplatesState: {
		list: [],
		refresh: vi.fn(),
		importEstimateTemplates: estimateTemplatesImportMock
	}
}));

vi.mock('$lib/state/project-structure-templates.svelte', () => ({
	projectStructureTemplatesState: {
		list: [],
		refresh: vi.fn()
	}
}));

vi.mock('$lib/state/classification-systems.svelte', () => ({
	classificationSystemsState: {
		list: [{ id: 'existing-system', name: 'Existing System' }],
		activeSystemId: null,
		costCodes: [],
		hydrate: classificationSystemsHydrateMock,
		refresh: vi.fn(),
		refreshCostCodes: vi.fn(),
		importClassificationSystems: classificationSystemsImportMock,
		importCostCodesWithHierarchy: costCodesHierarchyImportMock
	}
}));

vi.mock('$lib/services/db', () => ({
	dbService: {
		applySetupImportSession: applySetupImportSessionMock,
		getCostCodes: getCostCodesMock
	}
}));

describe('setupImportState', () => {
	afterEach(() => vi.restoreAllMocks());
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		applySetupImportSessionMock.mockResolvedValue(undefined);
		getCostCodesMock.mockResolvedValue([]);
		classificationSystemsHydrateMock.mockResolvedValue(undefined);
		workspaceStateMock.id = 'local-workspace';
		workspaceStateMock.countryCode = 'AU';
		(await import('$lib/state/contacts.svelte')).contactsState.list = [];
		(await import('$lib/state/materials.svelte')).materialsState.list = [];
		(await import('$lib/state/labour-rates.svelte')).labourRatesState.list = [];
		(await import('$lib/state/equipment-rates.svelte')).equipmentRatesState.list = [];
		(await import('$lib/state/subcontract-rates.svelte')).subcontractRatesState.list = [];
		(await import('$lib/state/cost-component-presets.svelte')).costComponentPresetsState.list = [];
		(await import('$lib/state/estimate-templates.svelte')).estimateTemplatesState.list = [];
		const { classificationSystemsState } = await import('$lib/state/classification-systems.svelte');
		classificationSystemsState.list = [
			{
				id: 'existing-system',
				workspace_id: 'workspace-1',
				name: 'Existing System',
				code: 'EX',
				classification_type: 'custom',
				aliases: [],
				is_default: false,
				created_at: '2026-03-01T00:00:00.000Z'
			}
		];
		classificationSystemsState.activeSystemId = null;
		classificationSystemsState.costCodes = [];
	});

	it('discards hashing from a cleared load without changing the replacement workbook', async () => {
		let finishHash!: (hash: ArrayBuffer) => void;
		vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(
			() => new Promise<ArrayBuffer>((resolve) => (finishHash = resolve))
		);
		prepareReadyMaterialWorkbook('replacement.csv');
		const { setupImportState } = await import('./setup-import.svelte');
		const staleLoad = setupImportState.loadFile({
			fileName: 'stale.csv',
			sourcePath: '/synthetic/stale.csv',
			text: 'stale'
		});
		setupImportState.clear();
		await setupImportState.loadFile({
			fileName: 'replacement.csv',
			sourcePath: '/synthetic/replacement.csv',
			text: 'replacement'
		});
		const replacementHash = setupImportState.sourceContentHash;
		finishHash(new ArrayBuffer(32));
		await staleLoad;
		expect(setupImportState.sourceFileName).toBe('replacement.csv');
		expect(setupImportState.sourceContentHash).toBe(replacementHash);
		expect(parseSetupImportFileMock).toHaveBeenCalledOnce();
		expect(setupImportState.isLoading).toBe(false);
	});

	it.each(['success', 'failure'])(
		'discards stale analysis %s after clearing and loading a different workbook',
		async (result) => {
			const staleWorkbook = prepareReadyMaterialWorkbook('stale.csv');
			let finishAnalysis!: (workbook: SetupImportWorkbook) => void;
			let failAnalysis!: (error: Error) => void;
			parseSetupImportFileMock.mockImplementationOnce(
				() =>
					new Promise<SetupImportWorkbook>((resolve, reject) => {
						finishAnalysis = resolve;
						failAnalysis = reject;
					})
			);
			const { setupImportState } = await import('./setup-import.svelte');
			const staleLoad = setupImportState.loadFile({
				fileName: 'stale.csv',
				sourcePath: '/synthetic/stale.csv',
				text: 'stale'
			});
			await vi.waitFor(() => expect(parseSetupImportFileMock).toHaveBeenCalledOnce());
			setupImportState.clear();
			prepareReadyMaterialWorkbook('replacement.csv');
			await setupImportState.loadFile({
				fileName: 'replacement.csv',
				sourcePath: '/synthetic/replacement.csv',
				text: 'replacement'
			});
			if (result === 'success') finishAnalysis(staleWorkbook);
			else failAnalysis(new Error('Late stale workbook failure'));
			await expect(staleLoad).resolves.toBeUndefined();
			expect(setupImportState.sourceFileName).toBe('replacement.csv');
			expect(setupImportState.workbook?.fileName).toBe('replacement.csv');
			expect(setupImportState.readySheetCount).toBe(1);
			expect(errorCatchMock).not.toHaveBeenCalled();
		}
	);

	it('records a committed import before failed refresh and retries refresh without writing rows again', async () => {
		prepareReadyMaterialWorkbook();
		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/synthetic/materials.csv',
			text: 'Name\nSynthetic Plate'
		});
		const { contactsState } = await import('$lib/state/contacts.svelte');
		const refreshError = new Error('Cannot refresh imported data');
		vi.mocked(contactsState.refresh).mockRejectedValueOnce(refreshError);
		await expect(setupImportState.applyImport()).resolves.toBeNull();
		expect(setupImportState.hasPendingImportRefresh).toBe(true);
		expect(setupImportState.getSheetSessionState('materials')).toBe('imported');
		expect(setupImportState.lastImportRunSummary).toMatchObject({ totalCreated: 1 });
		expect(errorCatchMock).toHaveBeenCalledWith(
			refreshError,
			'Refresh imported setup data',
			undefined,
			{
				description: 'Your data was imported. Refresh it to continue without importing it again.'
			}
		);
		const summary = await setupImportState.applyImport();
		expect(summary).toMatchObject({ totalCreated: 1 });
		expect(applySetupImportSessionMock).toHaveBeenCalledOnce();
		expect(contactsState.refresh).toHaveBeenCalledTimes(2);
		expect(setupImportState.hasPendingImportRefresh).toBe(false);
		expect(setupImportState.getSheetSessionState('materials')).toBe('imported');
	});

	it('waits for every refresh to settle before allowing refresh retry', async () => {
		prepareReadyMaterialWorkbook();
		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/synthetic/materials.csv',
			text: 'Name\nSynthetic Plate'
		});
		const { contactsState } = await import('$lib/state/contacts.svelte');
		const { materialsState } = await import('$lib/state/materials.svelte');
		vi.mocked(contactsState.refresh).mockRejectedValueOnce(new Error('Cannot refresh contacts'));
		let finishRefresh!: () => void;
		vi.mocked(materialsState.refresh).mockReturnValueOnce(
			new Promise<void>((resolve) => (finishRefresh = resolve))
		);
		const importing = setupImportState.applyImport();
		await vi.waitFor(() => expect(materialsState.refresh).toHaveBeenCalledOnce());
		expect(setupImportState.isImporting).toBe(true);
		expect(setupImportState.getSheetSessionState('materials')).toBe('imported');
		await expect(setupImportState.applyImport()).resolves.toBeNull();
		finishRefresh();
		await expect(importing).resolves.toBeNull();
		await setupImportState.applyImport();
		expect(applySetupImportSessionMock).toHaveBeenCalledOnce();
		expect(materialsState.refresh).toHaveBeenCalledTimes(2);
	});

	it('keeps an in-flight native import busy after Close and leaves a new session untouched', async () => {
		prepareReadyMaterialWorkbook();
		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/synthetic/materials.csv',
			text: 'Name\nSynthetic Plate'
		});
		let finishCommit!: () => void;
		applySetupImportSessionMock.mockReturnValueOnce(
			new Promise<void>((resolve) => (finishCommit = resolve))
		);
		const importing = setupImportState.applyImport();
		await vi.waitFor(() => expect(applySetupImportSessionMock).toHaveBeenCalledOnce());
		setupImportState.clear();
		expect(setupImportState.isImporting).toBe(true);
		await setupImportState.loadFile({
			fileName: 'replacement.csv',
			sourcePath: '/synthetic/replacement.csv',
			text: 'replacement'
		});
		await expect(setupImportState.applyImport()).resolves.toBeNull();
		expect(parseSetupImportFileMock).toHaveBeenCalledOnce();
		finishCommit();
		await expect(importing).resolves.toBeNull();
		const { contactsState } = await import('$lib/state/contacts.svelte');
		const { materialsState } = await import('$lib/state/materials.svelte');
		expect(contactsState.refresh).toHaveBeenCalledOnce();
		expect(materialsState.refresh).toHaveBeenCalledOnce();
		expect(setupImportState.isImporting).toBe(false);
		expect(setupImportState.workbook).toBeNull();
		expect(setupImportState.lastImportRunSummary).toBeNull();
		expect(setupImportState.importedSheetSignatures.size).toBe(0);
	});

	it('reports an already-committed refresh failure after Close without resurrecting the workbook', async () => {
		prepareReadyMaterialWorkbook();
		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/synthetic/materials.csv',
			text: 'Name\nSynthetic Plate'
		});
		const { contactsState } = await import('$lib/state/contacts.svelte');
		const refreshError = new Error('Cannot refresh committed data');
		vi.mocked(contactsState.refresh).mockRejectedValueOnce(refreshError);
		let finishCommit!: () => void;
		applySetupImportSessionMock.mockReturnValueOnce(
			new Promise<void>((resolve) => (finishCommit = resolve))
		);
		const importing = setupImportState.applyImport();
		await vi.waitFor(() => expect(applySetupImportSessionMock).toHaveBeenCalledOnce());
		setupImportState.clear();
		finishCommit();
		await expect(importing).resolves.toBeNull();
		expect(errorCatchMock).toHaveBeenCalledWith(
			refreshError,
			'Refresh imported setup data',
			undefined,
			{
				description:
					'Your data was imported. Reopen the affected page or restart Kwantflow to refresh it.'
			}
		);
		expect(setupImportState.workbook).toBeNull();
		expect(setupImportState.isImporting).toBe(false);
	});

	it('keeps changed-sheet signatures after retrying a failed post-commit refresh', async () => {
		prepareReadyMaterialWorkbook();
		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/synthetic/materials.csv',
			text: 'Name\nSynthetic Plate'
		});
		const { contactsState } = await import('$lib/state/contacts.svelte');
		vi.mocked(contactsState.refresh).mockRejectedValueOnce(new Error('Cannot refresh data'));
		await setupImportState.applyImport();
		setupImportState.setSheetImportMode('materials', 'update_matched');
		expect(setupImportState.getSheetSessionState('materials')).toBe('dirty_after_import');
		await setupImportState.applyImport();
		expect(applySetupImportSessionMock).toHaveBeenCalledOnce();
		expect(setupImportState.getSheetSessionState('materials')).toBe('dirty_after_import');
		await setupImportState.applyImport();
		expect(applySetupImportSessionMock).toHaveBeenCalledTimes(2);
		expect(setupImportState.getSheetSessionState('materials')).toBe('imported');
	});

	it('loads a workbook, stores analysis, and auto-selects the first importable sheet', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Acme' }],
					sampleRows: [{ name: 'Acme' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['contacts']
			},
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					targetTable: 'contacts',
					readiness: 'ready',
					summary: 'Companies',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'display_name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'kind',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ kind: 'company', display_name: 'Acme', name: 'Acme', country_code: 'AU' }],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.sourceFileName).toBe('setup.xlsx');
		expect(setupImportState.activeSheetId).toBe('contacts');
		expect(setupImportState.readySheetCount).toBe(1);
		expect(setupImportState.totalValidRowCount).toBe(1);
	}, 10_000);

	it('tracks duplicate summaries and passes the selected import mode to table imports', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['code', 'name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ code: 'MAT-001', name: 'Alpha Plate' }],
					sampleRows: [{ code: 'MAT-001', name: 'Alpha Plate' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'code',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'name',
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
					code: 'MAT-001',
					name: 'Alpha Plate',
					category: '',
					specification: '',
					unit: 'kg',
					default_rate: 2.85,
					is_active: true
				}
			],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { materialsState } = await import('$lib/state/materials.svelte');
		materialsState.list = [
			{
				id: 'material-1',
				workspace_id: 'workspace-1',
				code: 'MAT-001',
				name: 'Alpha Plate',
				category: '',
				specification: '',
				unit: 'kg',
				default_rate: 2.85,
				metadata: {},
				is_active: true,
				created_at: '2026-03-01T00:00:00.000Z',
				updated_at: '2026-03-01T00:00:00.000Z'
			}
		];

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.getSheetImportMode('materials')).toBe('keep_existing');
		expect(setupImportState.getSheetDuplicateSummary('materials')).toEqual({
			matchedRowCount: 1,
			newRowCount: 0
		});

		setupImportState.setSheetImportMode('materials', 'update_matched');
		const summary = await setupImportState.applyImport();

		expect(applySetupImportSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				materials: [
					expect.objectContaining({
						action: 'update',
						data: expect.objectContaining({
							code: 'MAT-001',
							name: 'Alpha Plate',
							unit: 'kg',
							default_rate: 2.85,
							is_active: true
						})
					})
				]
			})
		);
		expect(setupImportState.readySheetCount).toBe(0);
		expect(setupImportState.importedSheetCount).toBe(1);
		expect(setupImportState.getSheetSessionState('materials')).toBe('imported');
		expect(setupImportState.lastImportRunSummary).toMatchObject({
			totalCreated: 0,
			totalUpdated: 1,
			totalSkipped: 0,
			ignoredSheetCount: 0
		});
		expect(summary).toMatchObject({
			totalCreated: 0,
			totalUpdated: 1,
			totalSkipped: 0,
			ignoredSheetCount: 0,
			sheetResults: [expect.objectContaining({ sheetId: 'materials' })]
		});
	});

	it('resolves an exact company name into an atomic catalogue relationship import', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'materials.csv',
			fileExtension: 'csv',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [],
					sampleRows: []
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
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
					name: 'Steel Plate',
					code: '',
					category: '',
					specification: '',
					unit: 'kg',
					default_rate: 4.85,
					is_active: true,
					company_names: ['Acme Steel', 'Beta Metals']
				}
			],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);
		const { contactsState } = await import('$lib/state/contacts.svelte');
		contactsState.list = [
			{
				id: 'company-acme',
				kind: 'company',
				display_name: 'Acme Steel',
				name: 'Acme Steel',
				workspace_id: 'local-workspace',
				is_active: true
			} as never,
			{
				id: 'company-beta',
				kind: 'company',
				display_name: 'Beta Metals',
				name: 'Beta Metals',
				workspace_id: 'local-workspace',
				is_active: true
			} as never
		];

		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/tmp/materials.csv',
			text: 'unused'
		});
		await setupImportState.applyImport();

		expect(applySetupImportSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				companyCatalogueLinks: [
					expect.objectContaining({ scope: 'materials', companyId: 'company-acme' }),
					expect.objectContaining({ scope: 'materials', companyId: 'company-beta' })
				]
			})
		);
	});

	it('blocks a catalogue import when a supplied company name is missing or ambiguous', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'materials.csv',
			fileExtension: 'csv',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [],
					sampleRows: []
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
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
				{ name: 'Steel Plate', unit: 'kg', default_rate: 4.85, company_names: ['Unknown Steel'] }
			],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'materials.csv',
			sourcePath: '/tmp/materials.csv',
			text: 'unused'
		});

		expect(setupImportState.getImportPreflight()).toMatchObject({
			canApply: false,
			dependencyErrors: [
				expect.objectContaining({ message: expect.stringContaining('Unknown Steel') })
			]
		});
	});

	it('marks an imported sheet as dirty after mappings change and allows re-import', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					headers: ['name', 'email'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Acme', email: 'hello@example.com' }],
					sampleRows: [{ name: 'Acme', email: 'hello@example.com' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['contacts']
			},
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					targetTable: 'contacts',
					readiness: 'ready',
					summary: 'Companies',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'display_name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'kind',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'email',
							targetField: 'email',
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
					kind: 'company',
					display_name: 'Acme',
					country_code: 'AU',
					name: 'Acme',
					company_name: 'Acme',
					contact_name: '',
					email: 'hello@example.com',
					website: '',
					phone: '',
					phone_country_code: 'AU',
					phone_e164: '',
					abn: '',
					business_id_label: '',
					business_id_value: '',
					tax_id_label: '',
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
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		await setupImportState.applyImport();

		expect(setupImportState.getSheetSessionState('contacts')).toBe('imported');
		expect(setupImportState.readySheetCount).toBe(0);

		setupImportState.updateSheetMapping('contacts', 'email', null, { ignored: true });

		expect(setupImportState.getSheetSessionState('contacts')).toBe('dirty_after_import');
		expect(setupImportState.readySheetCount).toBe(1);

		setupImportState.updateSheetMapping('contacts', 'email', 'email');

		expect(setupImportState.getSheetSessionState('contacts')).toBe('imported');
		expect(setupImportState.readySheetCount).toBe(0);
	});

	it('imports classification systems first and then routes cost codes into the imported system', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'systems',
					sheetName: 'Systems',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'MasterFormat' }],
					sampleRows: [{ name: 'MasterFormat' }]
				},
				{
					sheetId: 'codes',
					sheetName: 'Codes',
					headers: ['code', 'name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ code: '01', name: 'General' }],
					sampleRows: [{ code: '01', name: 'General' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 2,
				ignoredSheetCount: 0,
				reviewPriority: ['systems', 'codes']
			},
			sheets: [
				{
					sheetId: 'systems',
					sheetName: 'Systems',
					targetTable: 'classification_systems',
					readiness: 'ready',
					summary: 'Classification systems',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				},
				{
					sheetId: 'codes',
					sheetName: 'Codes',
					targetTable: 'cost_codes',
					readiness: 'ready',
					summary: 'Cost codes',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'code',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation((sheet: { sheetId: string }) => {
			if (sheet.sheetId === 'systems') {
				return {
					validRows: [
						{ name: 'MasterFormat', code: '', classification_type: 'custom', is_default: false }
					],
					errors: [],
					blocked: false
				};
			}
			return {
				validRows: [
					{
						parent_id: null,
						code: '01',
						name: 'General',
						description: '',
						is_active: true,
						sort_order: 0
					}
				],
				errors: [],
				blocked: false
			};
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);
		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		await setupImportState.applyImport();

		expect(applySetupImportSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				classificationSystems: [
					expect.objectContaining({
						action: 'create',
						data: expect.objectContaining({
							name: 'MasterFormat',
							code: '',
							classification_type: 'custom',
							is_default: false
						})
					})
				],
				costCodes: [
					expect.objectContaining({
						action: 'create',
						data: expect.objectContaining({
							parent_id: null,
							code: '01',
							name: 'General',
							description: '',
							is_active: true,
							sort_order: 0
						})
					})
				]
			})
		);
	});

	it('blocks apply before final import when cost-code parents cannot be resolved', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'codes',
					sheetName: 'Codes',
					headers: ['code', 'name', 'parent_id'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ code: 'CC-110', name: 'Child Code', parent_id: 'CC-100' }],
					sampleRows: [{ code: 'CC-110', name: 'Child Code', parent_id: 'CC-100' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['codes']
			},
			sheets: [
				{
					sheetId: 'codes',
					sheetName: 'Codes',
					targetTable: 'cost_codes',
					readiness: 'ready',
					summary: 'Cost codes',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'code',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'parent_id',
							targetField: 'parent_id',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation(
			(_workbookSheet, _sheet, options?: { costCodeExistingCodes?: Array<{ code: string }> }) => ({
				validRows: options?.costCodeExistingCodes?.some((item) => item.code === 'CC-100')
					? [
							{
								parent_id: 'CC-100',
								code: 'CC-110',
								name: 'Child Code',
								description: '',
								is_active: true,
								sort_order: 0
							}
						]
					: [],
				errors: options?.costCodeExistingCodes?.some((item) => item.code === 'CC-100')
					? []
					: [
							{
								rowNumber: 2,
								messages: [
									'Parent cost code "CC-100" must exist in this sheet or in the selected classification system.'
								],
								fieldIssues: [
									{
										fieldId: 'parent_id',
										message:
											'Parent cost code "CC-100" must exist in this sheet or in the selected classification system.'
									}
								],
								raw: { code: 'CC-110', name: 'Child Code', parent_id: 'CC-100' },
								mappedValues: { code: 'CC-110', name: 'Child Code', parent_id: 'CC-100' }
							}
						],
				blocked: false
			})
		);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		setupImportState.setCostCodeSystemSelection('codes', 'existing:existing-system');
		await vi.waitFor(() => {
			expect(setupImportState.getImportPreflight().canApply).toBe(false);
		});

		await setupImportState.applyImport();

		expect(setupImportState.getImportPreflight().blockedSheetIds).toEqual(['codes']);
		expect(applySetupImportSessionMock).not.toHaveBeenCalled();
		expect(errorCatchMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message:
					'Parent cost code "CC-100" must exist in this sheet or in the selected classification system.'
			}),
			'Apply setup import'
		);
	});

	it('hydrates classification systems before resolving cost-code system options', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'codes',
					sheetName: 'Cost Codes',
					headers: ['Code', 'Name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ Code: 'CC-100', Name: 'Structural Steel' }],
					sampleRows: [{ Code: 'CC-100', Name: 'Structural Steel' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				totalSheets: 1,
				importableSheetCount: 1,
				ignoredSheetCount: 0
			},
			sheets: [
				{
					sheetId: 'codes',
					sheetName: 'Cost Codes',
					targetTable: 'cost_codes',
					summary: 'Cost Codes',
					readiness: 'blocked',
					missingRequiredFields: [],
					unmatchedColumns: [],
					ignoredColumns: [],
					mappings: [
						{
							sourceColumn: 'Code',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Exact match'
						},
						{
							sourceColumn: 'Name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Exact match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ code: 'CC-100', name: 'Structural Steel', parent_id: null, sort_order: 0 }],
			errors: [],
			skippedRowCount: 0,
			rowValidationDeferred: false,
			blocked: false
		});

		const { classificationSystemsState } = await import('$lib/state/classification-systems.svelte');
		classificationSystemsState.list = [];
		classificationSystemsHydrateMock.mockImplementation(async () => {
			classificationSystemsState.list = [
				{
					id: 'existing-system',
					workspace_id: 'workspace-1',
					name: 'Existing System',
					code: 'EX',
					classification_type: 'custom',
					aliases: [],
					is_default: false,
					created_at: '2026-03-01T00:00:00.000Z'
				}
			];
		});

		const { setupImportState } = await import('./setup-import.svelte');
		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(classificationSystemsHydrateMock).toHaveBeenCalledTimes(1);
		expect(setupImportState.getCostCodeSystemOptions('codes')).toEqual([
			expect.objectContaining({
				value: 'existing:existing-system',
				label: 'Existing · Existing System',
				kind: 'existing'
			})
		]);
		expect(setupImportState.costCodeSystemSelections.get('codes')).toBe('existing:existing-system');
	});

	it('blocks apply before final import when an equipment rate unit is unsupported', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'equipment',
					sheetName: 'Plant Hire',
					headers: ['name', 'default_rate', 'unit'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Crane Hire', default_rate: '2400', unit: 'Fortnightly' }],
					sampleRows: [{ name: 'Crane Hire', default_rate: '2400', unit: 'Fortnightly' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['equipment']
			},
			sheets: [
				{
					sheetId: 'equipment',
					sheetName: 'Plant Hire',
					targetTable: 'equipment_rates',
					readiness: 'ready',
					summary: 'Equipment Rates',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'default_rate',
							targetField: 'default_rate',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'unit',
							targetField: 'unit',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [],
			errors: [
				{
					rowNumber: 2,
					messages: [
						'Equipment unit "Fortnightly" is not supported. Use one of: min, hr, day, shift, week, fixed.'
					],
					fieldIssues: [
						{
							fieldId: 'unit',
							message:
								'Equipment unit "Fortnightly" is not supported. Use one of: min, hr, day, shift, week, fixed.'
						}
					],
					raw: { name: 'Crane Hire', default_rate: '2400', unit: 'Fortnightly' },
					mappedValues: { name: 'Crane Hire', default_rate: '2400', unit: 'Fortnightly' }
				}
			],
			blocked: false
		});

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.getImportPreflight().canApply).toBe(false);
		expect(setupImportState.getImportPreflight().blockedSheetIds).toEqual(['equipment']);

		await setupImportState.applyImport();

		expect(applySetupImportSessionMock).not.toHaveBeenCalled();
		expect(errorCatchMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message:
					'Equipment unit "Fortnightly" is not supported. Use one of: min, hr, day, shift, week, fixed.'
			}),
			'Apply setup import'
		);
	});

	it('analyses imports using the local workspace', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['material_name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ material_name: 'Plate' }],
					sampleRows: [{ material_name: 'Plate' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'needs_review',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'material_name',
							targetField: 'name',
							status: 'yellow',
							confidence: 'medium',
							reason: 'Needs confirmation'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ name: 'Plate' }],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(analyseSetupImportWorkbookMock).toHaveBeenCalledWith(
			expect.objectContaining({
				fileName: 'setup.xlsx',
				fileExtension: 'xlsx',
				sheets: [
					expect.objectContaining({
						sheetId: 'materials',
						sheetName: 'Materials'
					})
				]
			})
		);
	});

	it('keeps manual field remaps local without rerunning AI', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					headers: ['customer_email', 'name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ customer_email: 'hello@acme.test', name: 'Acme' }],
					sampleRows: [{ customer_email: 'hello@acme.test', name: 'Acme' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['contacts']
			},
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					targetTable: 'contacts',
					readiness: 'needs_review',
					summary: 'Companies',
					unmatchedColumns: ['customer_email'],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'customer_email',
							targetField: null,
							status: 'red',
							confidence: 'low',
							reason: 'No match'
						},
						{
							sourceColumn: 'name',
							targetField: 'display_name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'kind',
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
					kind: 'company',
					display_name: 'Acme',
					name: 'Acme',
					country_code: 'AU',
					email: 'hello@acme.test',
					website: ''
				}
			],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		setupImportState.updateSheetMapping('contacts', 'customer_email', 'email');

		expect(analyseSetupImportWorkbookMock).toHaveBeenCalledTimes(1);
		expect(
			setupImportState
				.getSheet('contacts')
				?.mappings.find((mapping) => mapping.sourceColumn === 'customer_email')
		).toEqual(
			expect.objectContaining({
				sourceColumn: 'customer_email',
				targetField: 'email',
				status: 'green'
			})
		);
	});

	it('lets users confirm a yellow mapping without reopening the field picker', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['Material Name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ 'Material Name': 'Plate' }],
					sampleRows: [{ 'Material Name': 'Plate' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'needs_review',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Material Name',
							targetField: 'name',
							status: 'yellow',
							confidence: 'medium',
							reason: 'Likely match from alias/header match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ name: 'Plate' }],
			errors: [],
			blocked: false
		});

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		setupImportState.confirmSuggestedMapping('materials', 'Material Name');

		expect(
			setupImportState
				.getSheet('materials')
				?.mappings.find((mapping) => mapping.sourceColumn === 'Material Name')
		).toEqual(
			expect.objectContaining({
				targetField: 'name',
				status: 'green',
				confidence: 'high',
				reason: 'Confirmed by user'
			})
		);
	});

	it('requires unresolved sheets to be assigned or explicitly ignored before the workbook is importable', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Plate' }],
					sampleRows: [{ name: 'Plate' }]
				},
				{
					sheetId: 'notes',
					sheetName: 'Read Me',
					headers: ['notes'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ notes: 'Internal guidance' }],
					sampleRows: [{ notes: 'Internal guidance' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 1,
				reviewPriority: ['materials', 'notes']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				},
				{
					sheetId: 'notes',
					sheetName: 'Read Me',
					targetTable: null,
					readiness: 'ignored',
					summary: 'Ignored',
					unmatchedColumns: ['notes'],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'notes',
							targetField: null,
							status: 'red',
							confidence: 'low',
							reason: 'Ignored by user'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation((sheet: { sheetId: string }) => {
			if (sheet.sheetId === 'materials') {
				return {
					validRows: [{ name: 'Plate' }],
					errors: [],
					blocked: false
				};
			}
			return {
				validRows: [],
				errors: [],
				blocked: false
			};
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.readySheetCount).toBe(1);
		expect(setupImportState.hasOutstandingSheets).toBe(true);
		expect(setupImportState.isSheetExplicitlyIgnored('notes')).toBe(false);

		setupImportState.updateSheetTargetTable('notes', null);

		expect(setupImportState.isSheetExplicitlyIgnored('notes')).toBe(true);
		expect(setupImportState.getSheet('notes')?.mappings).toEqual([
			expect.objectContaining({
				sourceColumn: 'notes',
				targetField: null,
				status: 'ignored',
				reason: 'Ignored by user'
			})
		]);
		expect(setupImportState.hasOutstandingSheets).toBe(false);
	});

	it('keeps inferred contact sheets out of blocked when company-style mappings satisfy required fields', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Client Master 2026',
					headers: ['Account Name', 'Country', 'Contact Person', 'Email'],
					headerIssues: [],
					rowCount: 1,
					rows: [
						{
							'Account Name': 'Acme Fabrication Pty Ltd',
							Country: 'AU',
							'Contact Person': 'Mia Collins',
							Email: 'estimating@acmefab.example'
						}
					],
					sampleRows: [
						{
							'Account Name': 'Acme Fabrication Pty Ltd',
							Country: 'AU',
							'Contact Person': 'Mia Collins',
							Email: 'estimating@acmefab.example'
						}
					]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['contacts']
			},
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Client Master 2026',
					targetTable: 'contacts',
					readiness: 'ready',
					summary: 'Companies',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Account Name',
							targetField: 'display_name',
							status: 'green',
							confidence: 'high',
							reason: 'Matched'
						},
						{
							sourceColumn: 'Country',
							targetField: 'country_code',
							status: 'green',
							confidence: 'high',
							reason: 'Matched'
						},
						{
							sourceColumn: 'Contact Person',
							targetField: 'person_name',
							status: 'green',
							confidence: 'high',
							reason: 'Matched'
						},
						{
							sourceColumn: 'Email',
							targetField: 'email',
							status: 'green',
							confidence: 'high',
							reason: 'Matched'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [
				{
					kind: 'company',
					display_name: 'Acme Fabrication Pty Ltd',
					name: 'Acme Fabrication Pty Ltd',
					country_code: 'AU'
				}
			],
			errors: [],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.getSheet('contacts')).toEqual(
			expect.objectContaining({
				readiness: 'ready',
				missingRequiredFields: []
			})
		);
		expect(setupImportState.hasBlockedSheets).toBe(false);
		expect(setupImportState.readySheetCount).toBe(1);
	});

	it('does not count sheets with row errors as ready for import', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['name'],
					headerIssues: [],
					rowCount: 2,
					rows: [{ name: 'Plate' }, { name: '' }],
					sampleRows: [{ name: 'Plate' }, { name: '' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ name: 'Plate' }],
			errors: [{ rowNumber: 3, messages: ['Name is blank in this row'] }],
			blocked: false
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.isSheetImportable('materials')).toBe(false);
		expect(setupImportState.readySheetCount).toBe(0);
		expect(setupImportState.hasOutstandingSheets).toBe(true);
	});

	it('reruns deterministic mapping suggestions when the user changes the target table', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'crew_rates',
					sheetName: 'Crew Rates',
					headers: ['Labour Code', 'Rate Name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ 'Labour Code': 'LAB-FAB', 'Rate Name': 'Fabricator Level 1' }],
					sampleRows: [{ 'Labour Code': 'LAB-FAB', 'Rate Name': 'Fabricator Level 1' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 0,
				ignoredSheetCount: 1,
				reviewPriority: ['crew_rates']
			},
			sheets: [
				{
					sheetId: 'crew_rates',
					sheetName: 'Crew Rates',
					targetTable: null,
					readiness: 'ignored',
					summary: 'Ignored',
					unmatchedColumns: ['Labour Code', 'Rate Name'],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Labour Code',
							targetField: null,
							status: 'red',
							confidence: 'low',
							reason: 'Ignored by user'
						},
						{
							sourceColumn: 'Rate Name',
							targetField: null,
							status: 'red',
							confidence: 'low',
							reason: 'Ignored by user'
						}
					]
				}
			]
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation(
			(_workbookSheet, sheet, targetTable) => ({
				...sheet,
				targetTable,
				readiness: 'needs_review',
				summary: 'Labour Rates',
				unmatchedColumns: [],
				missingRequiredFields: [],
				mappings: [
					{
						sourceColumn: 'Labour Code',
						targetField: 'code',
						status: 'green',
						confidence: 'high',
						reason: 'Matched from spreadsheet header'
					},
					{
						sourceColumn: 'Rate Name',
						targetField: 'name',
						status: 'green',
						confidence: 'high',
						reason: 'Matched from spreadsheet header'
					}
				]
			})
		);
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ code: 'LAB-FAB', name: 'Fabricator Level 1' }],
			errors: [],
			blocked: false
		});

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		setupImportState.updateSheetTargetTable('crew_rates', 'labour_rates');

		expect(suggestSetupImportSheetForTargetTableMock).toHaveBeenCalledTimes(1);
		expect(suggestSetupImportSheetForTargetTableMock.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				sheetId: 'crew_rates',
				sheetName: 'Crew Rates'
			})
		);
		expect(suggestSetupImportSheetForTargetTableMock.mock.calls[0]?.[2]).toBe('labour_rates');
		expect(suggestSetupImportSheetForTargetTableMock.mock.calls[0]?.[3]).toEqual(
			expect.objectContaining({ digestVersion: 'setup-import-v4' })
		);
		expect(setupImportState.getSheet('crew_rates')?.mappings).toEqual([
			expect.objectContaining({
				sourceColumn: 'Labour Code',
				targetField: 'code',
				status: 'green'
			}),
			expect.objectContaining({
				sourceColumn: 'Rate Name',
				targetField: 'name',
				status: 'green'
			})
		]);
		expect(previewSetupImportSheetMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				sheetId: 'crew_rates',
				sheetName: 'Crew Rates'
			}),
			expect.objectContaining({
				sheetId: 'crew_rates',
				targetTable: 'labour_rates'
			}),
			{ rowOverrides: {}, skippedRowNumbers: [], workspaceCountryCode: 'AU' }
		);
	});

	it('keeps free-text row fixes as drafts until the user applies them', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'systems',
					sheetName: 'Code Families',
					headers: ['System Name', 'Family Type'],
					headerIssues: [],
					rowCount: 2,
					rows: [
						{ 'System Name': 'Masterformat Fabrication', 'Family Type': 'masterformat' },
						{ 'System Name': '', 'Family Type': 'mystery' }
					],
					sampleRows: []
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['systems']
			},
			sheets: [
				{
					sheetId: 'systems',
					sheetName: 'Code Families',
					targetTable: 'classification_systems',
					readiness: 'ready',
					summary: 'Classification Systems',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'System Name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Matched'
						},
						{
							sourceColumn: 'Family Type',
							targetField: 'classification_type',
							status: 'green',
							confidence: 'high',
							reason: 'Matched'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation(
			(
				_sheet: unknown,
				_analysis: unknown,
				options: { rowOverrides?: Record<number, Record<string, string>> } = {}
			) => {
				const rowOverrides = options.rowOverrides ?? {};
				if (
					rowOverrides[3]?.name === 'Workshop Custom' &&
					rowOverrides[3]?.classification_type === 'custom'
				) {
					return {
						validRows: [
							{
								name: 'Masterformat Fabrication',
								classification_type: 'masterformat',
								aliases: [],
								is_default: false
							},
							{
								name: 'Workshop Custom',
								classification_type: 'custom',
								aliases: [],
								is_default: false
							}
						],
						errors: [],
						blocked: false
					};
				}
				return {
					validRows: [
						{
							name: 'Masterformat Fabrication',
							classification_type: 'masterformat',
							aliases: [],
							is_default: false
						}
					],
					errors: [
						{
							rowNumber: 3,
							messages: ['Name is blank in this row', 'Type must be valid'],
							fieldIssues: [
								{ fieldId: 'name', message: 'Name is blank in this row' },
								{ fieldId: 'classification_type', message: 'Type must be valid' }
							],
							raw: {},
							mappedValues: { name: '', classification_type: 'custom' }
						}
					],
					blocked: false
				};
			}
		);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		const previewCallCountBeforeDraft = previewSetupImportSheetMock.mock.calls.length;
		setupImportState.setRowFieldDraft('systems', 3, 'name', 'Workshop Custom');
		setupImportState.setRowFieldDraft('systems', 3, 'classification_type', 'custom');

		expect(setupImportState.getRowFieldDraft('systems', 3, 'name')).toBe('Workshop Custom');
		expect(previewSetupImportSheetMock.mock.calls.length).toBe(previewCallCountBeforeDraft);

		setupImportState.applyRowFix('systems', 3);

		expect(setupImportState.getRowFieldDraft('systems', 3, 'name')).toBe('');
		expect(setupImportState.getRowFieldOverride('systems', 3, 'name')).toBe('Workshop Custom');
		expect(setupImportState.activeSheetPreview?.errors).toEqual([]);
		expect(previewSetupImportSheetMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ sheetId: 'systems' }),
			expect.objectContaining({ sheetId: 'systems' }),
			{
				rowOverrides: { 3: { name: 'Workshop Custom', classification_type: 'custom' } },
				skippedRowNumbers: [],
				workspaceCountryCode: 'AU'
			}
		);

		setupImportState.updateSheetMapping('systems', 'Family Type', 'classification_type');

		expect(setupImportState.getRowFieldOverride('systems', 3, 'name')).toBe('');
		expect(previewSetupImportSheetMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ sheetId: 'systems' }),
			expect.objectContaining({ sheetId: 'systems' }),
			{ rowOverrides: {}, skippedRowNumbers: [], workspaceCountryCode: 'AU' }
		);
	});

	it('blocks workbook apply before any writes when a cost-code sheet points at an ignored pending system', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'systems',
					sheetName: 'Systems',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'MasterFormat' }],
					sampleRows: [{ name: 'MasterFormat' }]
				},
				{
					sheetId: 'codes',
					sheetName: 'Codes',
					headers: ['code', 'name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ code: '01', name: 'General' }],
					sampleRows: [{ code: '01', name: 'General' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 2,
				ignoredSheetCount: 0,
				reviewPriority: ['systems', 'codes']
			},
			sheets: [
				{
					sheetId: 'systems',
					sheetName: 'Systems',
					targetTable: 'classification_systems',
					readiness: 'ready',
					summary: 'Classification systems',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				},
				{
					sheetId: 'codes',
					sheetName: 'Codes',
					targetTable: 'cost_codes',
					readiness: 'ready',
					summary: 'Cost codes',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'code',
							targetField: 'code',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation((sheet: { sheetId: string }) => {
			if (sheet.sheetId === 'systems') {
				return {
					validRows: [{ name: 'MasterFormat' }],
					errors: [],
					blocked: false
				};
			}
			return {
				validRows: [{ code: '01', name: 'General' }],
				errors: [],
				blocked: false
			};
		});
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});
		setupImportState.setCostCodeSystemSelection('codes', 'pending:systems:0');
		setupImportState.updateSheetTargetTable('systems', null);

		expect(setupImportState.getImportPreflight().canApply).toBe(false);
		await expect(setupImportState.applyImport()).resolves.toBeNull();
		expect(errorCatchMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'The selected classification system is not ready yet. Import the system first.'
			}),
			'Apply setup import'
		);
		expect(classificationSystemsImportMock).not.toHaveBeenCalled();
		expect(costCodesHierarchyImportMock).not.toHaveBeenCalled();
	});

	it('clears the last import summary when apply fails after earlier sheet writes', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Plate' }],
					sampleRows: [{ name: 'Plate' }]
				},
				{
					sheetId: 'labour',
					sheetName: 'Labour',
					headers: ['name', 'unit'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Crew', unit: 'Hr' }],
					sampleRows: [{ name: 'Crew', unit: 'Hr' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 2,
				ignoredSheetCount: 0,
				reviewPriority: ['materials', 'labour']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				},
				{
					sheetId: 'labour',
					sheetName: 'Labour',
					targetTable: 'labour_rates',
					readiness: 'ready',
					summary: 'Labour rates',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'unit',
							targetField: 'unit',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation((sheet: { sheetId: string }) => {
			if (sheet.sheetId === 'materials') {
				return {
					validRows: [{ name: 'Plate', code: '', category: '', specification: '' }],
					errors: [],
					blocked: false
				};
			}
			return {
				validRows: [{ name: 'Crew', unit: 'Hr', code: '', category: '', work_center: '' }],
				errors: [],
				blocked: false
			};
		});
		applySetupImportSessionMock.mockRejectedValue(new Error('Labour write failed'));

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		await expect(setupImportState.applyImport()).resolves.toBeNull();
		expect(errorCatchMock).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'Labour write failed' }),
			'Apply setup import'
		);
		expect(applySetupImportSessionMock).toHaveBeenCalledTimes(1);
		expect(setupImportState.lastImportRunSummary).toBeNull();
	});

	it('applies one bulk remap to repeated row issues', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'labour',
					sheetName: 'Labour',
					headers: ['Crew', 'UOM'],
					headerIssues: [],
					rowCount: 2,
					rows: [
						{ Crew: 'Site Crew', UOM: 'Minutes' },
						{ Crew: 'Workshop Crew', UOM: 'Minutes' }
					],
					sampleRows: [
						{ Crew: 'Site Crew', UOM: 'Minutes' },
						{ Crew: 'Workshop Crew', UOM: 'Minutes' }
					]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['labour']
			},
			sheets: [
				{
					sheetId: 'labour',
					sheetName: 'Labour',
					targetTable: 'labour_rates',
					readiness: 'ready',
					summary: 'Labour Rates',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'Crew',
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
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation(
			(
				_sheet: unknown,
				_analysis: unknown,
				options: { rowOverrides?: Record<number, Record<string, string>> } = {}
			) => {
				const rowOverrides = options.rowOverrides ?? {};
				if (rowOverrides[2]?.unit === 'Min' && rowOverrides[3]?.unit === 'Min') {
					return {
						validRows: [
							{ name: 'Site Crew', unit: 'Min' },
							{ name: 'Workshop Crew', unit: 'Min' }
						],
						errors: [],
						blocked: false
					};
				}
				return {
					validRows: [],
					errors: [
						{
							rowNumber: 2,
							messages: ['Unit must be one of Min or Hr'],
							fieldIssues: [{ fieldId: 'unit', message: 'Unit must be one of Min or Hr' }],
							raw: {},
							mappedValues: { name: 'Site Crew', unit: 'Minutes' }
						},
						{
							rowNumber: 3,
							messages: ['Unit must be one of Min or Hr'],
							fieldIssues: [{ fieldId: 'unit', message: 'Unit must be one of Min or Hr' }],
							raw: {},
							mappedValues: { name: 'Workshop Crew', unit: 'Minutes' }
						}
					],
					blocked: false
				};
			}
		);
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.getRepeatedValueIssues('labour')).toEqual([
			{
				fieldId: 'unit',
				rawValue: 'Minutes',
				rowNumbers: [2, 3]
			}
		]);

		setupImportState.applyBulkValueRemap('labour', 'unit', 'Minutes', 'Min');

		expect(setupImportState.getBulkValueRemap('labour', 'unit', 'Minutes')).toBe('Min');
		expect(setupImportState.activeSheetPreview?.errors).toEqual([]);
	});

	it('treats skipped rows as resolved so the remaining valid rows can import', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					headers: ['name'],
					headerIssues: [],
					rowCount: 2,
					rows: [{ name: 'Plate' }, { name: '' }],
					sampleRows: [{ name: 'Plate' }, { name: '' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['materials']
			},
			sheets: [
				{
					sheetId: 'materials',
					sheetName: 'Materials',
					targetTable: 'materials',
					readiness: 'ready',
					summary: 'Materials',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockImplementation(
			(_sheet: unknown, _analysis: unknown, options: { skippedRowNumbers?: number[] } = {}) => {
				if ((options.skippedRowNumbers ?? []).includes(3)) {
					return {
						validRows: [{ name: 'Plate' }],
						errors: [],
						blocked: false,
						skippedRowCount: 1
					};
				}
				return {
					validRows: [{ name: 'Plate' }],
					errors: [
						{
							rowNumber: 3,
							messages: ['Name is blank in this row'],
							fieldIssues: [{ fieldId: 'name', message: 'Name is blank in this row' }],
							raw: {},
							mappedValues: { name: '' }
						}
					],
					blocked: false,
					skippedRowCount: 0
				};
			}
		);
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		expect(setupImportState.getImportPreflight().blockedSheetIds).toEqual(['materials']);

		setupImportState.skipRow('materials', 3);

		expect(setupImportState.getSkippedRowNumbers('materials')).toEqual([3]);
		expect(setupImportState.getImportPreflight().blockedSheetIds).toEqual([]);
		expect(setupImportState.getImportPreflight().readySheetIds).toEqual(['materials']);
	});

	it('contains setup import failures inside state without attempting legacy snapshot restore', async () => {
		parseSetupImportFileMock.mockResolvedValueOnce({
			fileName: 'setup.xlsx',
			fileExtension: 'xlsx',
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					headers: ['name'],
					headerIssues: [],
					rowCount: 1,
					rows: [{ name: 'Acme' }],
					sampleRows: [{ name: 'Acme' }]
				}
			]
		});
		analyseSetupImportWorkbookMock.mockResolvedValueOnce({
			workbookSummary: {
				importableSheetCount: 1,
				ignoredSheetCount: 0,
				reviewPriority: ['contacts']
			},
			sheets: [
				{
					sheetId: 'contacts',
					sheetName: 'Companies',
					targetTable: 'contacts',
					readiness: 'ready',
					summary: 'Companies',
					unmatchedColumns: [],
					missingRequiredFields: [],
					mappings: [
						{
							sourceColumn: 'name',
							targetField: 'display_name',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						},
						{
							sourceColumn: 'name',
							targetField: 'kind',
							status: 'green',
							confidence: 'high',
							reason: 'Direct match'
						}
					]
				}
			]
		});
		previewSetupImportSheetMock.mockReturnValue({
			validRows: [{ kind: 'company', display_name: 'Acme', name: 'Acme', country_code: 'AU' }],
			errors: [],
			blocked: false,
			skippedRowCount: 0
		});
		applySetupImportSessionMock.mockRejectedValueOnce(new Error('contacts import failed'));
		suggestSetupImportSheetForTargetTableMock.mockImplementation((_workbookSheet, sheet) => sheet);

		const { setupImportState } = await import('./setup-import.svelte');

		await setupImportState.loadFile({
			fileName: 'setup.xlsx',
			sourcePath: '/tmp/setup.xlsx',
			bytes: new Uint8Array([1, 2, 3])
		});

		await expect(setupImportState.applyImport()).resolves.toBeNull();
		expect(errorCatchMock).toHaveBeenCalledWith(expect.any(Error), 'Apply setup import');
		expect(applySetupImportSessionMock).toHaveBeenCalledTimes(1);
	});
});
