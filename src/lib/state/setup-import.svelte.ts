import { SvelteMap } from 'svelte/reactivity';

import {
	buildSetupImportSchemaDigest,
	buildSetupImportPendingContactCompanyKey,
	analyseCostCodeHierarchy,
	deriveSetupImportSheetReadiness,
	loadSetupImportFileAnalysis,
	previewSetupImportSheet,
	suggestSetupImportSheetForTargetTable,
	SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX,
	type ParseSetupImportFileInput,
	type SetupImportAnalysis,
	type SetupImportCostPresetRow,
	type SetupImportCatalogueRow,
	type SetupImportDuplicateMode,
	type SetupImportEstimateTemplateRow,
	type SetupImportProjectStructureTemplateRow,
	type SetupImportRowFieldOverrides,
	type SetupImportSheetAnalysis,
	type SetupImportSheetPreview,
	type SetupImportWorkbook,
	type SetupImportWorkbookSheet
} from '$lib/services/setup-import.js';
import type {
	SetupImportSchemaTableDigest,
	SetupImportTargetTable
} from '$lib/constants/setup-import-registry.js';
import { errorState } from '$lib/state/errors.svelte.js';
import { createLogger } from '$lib/services/logger.js';
import { contactsState } from '$lib/state/contacts.svelte.js';
import { materialsState } from '$lib/state/materials.svelte.js';
import { labourRatesState } from '$lib/state/labour-rates.svelte.js';
import { equipmentRatesState } from '$lib/state/equipment-rates.svelte.js';
import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';
import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';
import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';
import { projectStructureTemplatesState } from '$lib/state/project-structure-templates.svelte.js';
import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
import { workspaceState } from '$lib/state/workspace.svelte.js';
import { dbService, type SetupImportSessionPayload } from '$lib/services/db.js';
import type {
	ClassificationSystemFormValues,
	CostCodeFormValues,
	ContactFormValues,
	EquipmentRateCardFormValues,
	LabourRateCardFormValues,
	MaterialCatalogItemFormValues,
	SubcontractRateCardFormValues
} from '$lib/schemas/index.js';
import type { Contact, CostCode } from '$lib/types/index.js';

type SetupImportSystemOption = {
	value: string;
	label: string;
	kind: 'existing' | 'pending';
};

type SetupImportDuplicateSummary = {
	matchedRowCount: number;
	newRowCount: number;
};

type SetupImportSheetSessionState = 'not_imported' | 'imported' | 'dirty_after_import';

type SetupImportSheetImportResult = {
	sheetId: string;
	sheetName: string;
	targetTable: SetupImportTargetTable;
	created: number;
	updated: number;
	skipped: number;
	skippedRows: number;
	validRowCount: number;
	importedAt: string;
};

type SetupImportRunSummary = {
	importedAt: string;
	sheetResults: SetupImportSheetImportResult[];
	totalCreated: number;
	totalUpdated: number;
	totalSkipped: number;
	totalSkippedRows: number;
	ignoredSheetCount: number;
};

type SetupImportDependencyIssue = {
	sheetId: string;
	message: string;
};

type SetupImportPreflight = {
	canApply: boolean;
	readySheetIds: string[];
	blockedSheetIds: string[];
	dependencyErrors: SetupImportDependencyIssue[];
	remediationRequired: boolean;
};

type SetupImportCompanyCandidate = Pick<
	Contact,
	'id' | 'kind' | 'display_name' | 'name' | 'company_name' | 'business_id_value'
>;

function findSetupImportCompanyMatches(
	companyName: string | null | undefined,
	companies: SetupImportCompanyCandidate[]
): SetupImportCompanyCandidate[] {
	const target = normaliseLookupValue(companyName);
	if (!target) return [];
	return companies.filter((company) => {
		if (company.kind !== 'company') return false;
		return [company.display_name, company.name, company.company_name, company.business_id_value]
			.map(normaliseLookupValue)
			.includes(target);
	});
}

type SetupImportRepeatedValueIssue = {
	fieldId: string;
	rawValue: string;
	rowNumbers: number[];
};

type SetupImportApplyBuild = {
	payload: Omit<SetupImportSessionPayload, 'audit'>;
	sheetResults: SetupImportSheetImportResult[];
	signatures: Map<string, string>;
	resolvedPendingSystems: Map<string, string>;
};

const COST_CODE_SYSTEM_PREFIX = 'existing:';
const PENDING_SYSTEM_PREFIX = 'pending:';
const log = createLogger('setupImportState');
const SHEET_IMPORT_ORDER: SetupImportTargetTable[] = [
	'contacts',
	'materials',
	'labour_rates',
	'equipment_rates',
	'subcontract_rates',
	'cost_presets',
	'estimate_templates',
	'project_structure_templates',
	'classification_systems',
	'cost_codes'
];

function buildIgnoredMappingReason(): string {
	return 'Ignored by user';
}

function buildPendingSystemValue(sheetId: string, rowIndex: number): string {
	return `${PENDING_SYSTEM_PREFIX}${sheetId}:${rowIndex}`;
}

function buildRowOverrideKey(sheetId: string, rowNumber: number, fieldId: string): string {
	return `${sheetId}:${rowNumber}:${fieldId}`;
}

function buildBulkValueRemapKey(sheetId: string, fieldId: string, rawValue: string): string {
	return `${sheetId}:${fieldId}:${rawValue}`;
}

function buildRowSkipKey(sheetId: string, rowNumber: number): string {
	return `${sheetId}:${rowNumber}`;
}

function parsePendingSystemValue(value: string): { sheetId: string; rowIndex: number } | null {
	if (!value.startsWith(PENDING_SYSTEM_PREFIX)) return null;
	const [sheetId, rawIndex] = value.slice(PENDING_SYSTEM_PREFIX.length).split(':');
	const rowIndex = Number(rawIndex);
	if (!sheetId || Number.isNaN(rowIndex)) return null;
	return { sheetId, rowIndex };
}

function buildExistingSystemValue(systemId: string): string {
	return `${COST_CODE_SYSTEM_PREFIX}${systemId}`;
}

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function buildImportRunSummary(
	sheetResults: SetupImportSheetImportResult[],
	ignoredSheetCount: number
): SetupImportRunSummary {
	return {
		importedAt: new Date().toISOString(),
		sheetResults,
		totalCreated: sheetResults.reduce((sum, result) => sum + result.created, 0),
		totalUpdated: sheetResults.reduce((sum, result) => sum + result.updated, 0),
		totalSkipped: sheetResults.reduce((sum, result) => sum + result.skipped, 0),
		totalSkippedRows: sheetResults.reduce((sum, result) => sum + result.skippedRows, 0),
		ignoredSheetCount
	};
}

function getContactDisplayName(contact: Pick<Contact, 'display_name' | 'name'>): string {
	return contact.display_name?.trim() || contact.name.trim();
}

function getScopedPersonName(
	contact: Pick<
		Contact | ContactFormValues,
		'display_name' | 'name' | 'person_first_name' | 'person_last_name'
	>
): string {
	return (
		contact.display_name?.trim() ||
		contact.name?.trim() ||
		[contact.person_first_name?.trim(), contact.person_last_name?.trim()]
			.filter(Boolean)
			.join(' ')
			.trim()
	);
}

function getComparableContactEmail(contact: Pick<Contact | ContactFormValues, 'email'>): string {
	return normaliseLookupValue(contact.email);
}

function getComparableBusinessKey(
	contact: Pick<Contact | ContactFormValues, 'business_id_value' | 'country_code'>
): string {
	const businessId = normaliseLookupValue(contact.business_id_value);
	const countryCode = normaliseLookupValue(contact.country_code);
	return businessId && countryCode ? `${countryCode}|${businessId}` : '';
}

function normaliseSetupImportContactInput(row: ContactFormValues): ContactFormValues {
	const displayName =
		row.display_name?.trim() ||
		row.name.trim() ||
		row.company_name?.trim() ||
		[row.person_first_name?.trim(), row.person_last_name?.trim()].filter(Boolean).join(' ').trim();

	return {
		kind: row.kind ?? 'company',
		country_code: row.country_code,
		display_name: displayName,
		name: displayName,
		company_name: row.company_name ?? row.name,
		person_first_name: row.person_first_name ?? '',
		person_last_name: row.person_last_name ?? '',
		role_title: row.role_title ?? '',
		linked_company_id: row.linked_company_id ?? '',
		is_primary_company_contact: row.is_primary_company_contact ?? false,
		contact_name: row.contact_name ?? '',
		email: row.email ?? '',
		website: row.website ?? '',
		phone: row.phone ?? '',
		phone_country_code: row.phone_country_code ?? row.country_code,
		phone_e164: row.phone_e164 ?? '',
		abn: row.abn ?? '',
		business_id_label: row.business_id_label ?? 'Business ID',
		business_id_value: row.business_id_value ?? '',
		tax_id_label: row.tax_id_label ?? 'Tax ID',
		tax_id_value: row.tax_id_value ?? '',
		address: row.address ?? '',
		notes: row.notes ?? '',
		logo_file_path: row.logo_file_path ?? '',
		custom_role_label: row.custom_role_label ?? '',
		roles: row.roles ?? [],
		tags: row.tags ?? [],
		is_active: row.is_active ?? true
	};
}

function resolvePendingCompanyLinkForSetupImport(
	row: ContactFormValues,
	pendingCompanyIds: Map<string, string>
): ContactFormValues {
	if (
		row.kind !== 'person' ||
		!row.linked_company_id ||
		!row.linked_company_id.startsWith(SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX)
	) {
		return row;
	}

	const pendingKey = row.linked_company_id.slice(
		SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX.length
	);
	const resolvedCompanyId = pendingCompanyIds.get(pendingKey);
	if (!resolvedCompanyId) return row;

	return {
		...row,
		linked_company_id: resolvedCompanyId
	};
}

function buildContactCandidate(id: string, row: ContactFormValues): Contact {
	return {
		id,
		workspace_id: '',
		sort_order: 0,
		kind: row.kind ?? 'company',
		display_name: row.display_name || row.name,
		name: row.name,
		company_name: row.company_name ?? '',
		person_first_name: row.person_first_name ?? '',
		person_last_name: row.person_last_name ?? '',
		role_title: row.role_title ?? '',
		linked_company_id: row.linked_company_id ?? '',
		is_primary_company_contact: row.is_primary_company_contact ?? false,
		country_code: row.country_code,
		contact_name: row.contact_name ?? '',
		email: row.email ?? '',
		website: row.website ?? '',
		phone: row.phone ?? '',
		phone_e164: row.phone_e164 ?? '',
		phone_country_code: row.phone_country_code ?? row.country_code,
		abn: row.abn ?? '',
		business_id_label: row.business_id_label ?? 'Business ID',
		business_id_value: row.business_id_value ?? '',
		tax_id_label: row.tax_id_label ?? 'Tax ID',
		tax_id_value: row.tax_id_value ?? '',
		address: row.address ?? '',
		notes: row.notes ?? '',
		logo_file_path: row.logo_file_path ?? '',
		custom_role_label: row.custom_role_label ?? '',
		roles: row.roles ?? [],
		tags: row.tags ?? [],
		is_active: row.is_active ?? true,
		created_at: '',
		updated_at: ''
	};
}

function findMatchingSetupImportContact(
	contacts: Contact[],
	row: ContactFormValues,
	excludeId?: string
): Contact | null {
	const normalizedRow = normaliseSetupImportContactInput(row);
	const candidates = contacts.filter((contact) => contact.id !== excludeId);

	if (normalizedRow.kind === 'person') {
		const linkedCompanyId = normalizedRow.linked_company_id?.trim() ?? '';
		const personEmail = getComparableContactEmail(normalizedRow);
		const personName = normaliseLookupValue(getScopedPersonName(normalizedRow));

		return (
			candidates.find((contact) => {
				if ((contact.kind ?? 'person') !== 'person') return false;
				if (personName.length > 0 && normaliseLookupValue(contact.name ?? '') === personName) {
					return true;
				}
				if ((contact.linked_company_id ?? '') !== linkedCompanyId) return false;
				if (personEmail && getComparableContactEmail(contact) === personEmail) return true;
				return (
					personName.length > 0 && normaliseLookupValue(getScopedPersonName(contact)) === personName
				);
			}) ?? null
		);
	}

	const businessKey = getComparableBusinessKey(normalizedRow);
	const companyName = normaliseLookupValue(getContactDisplayName(normalizedRow));

	return (
		candidates.find((contact) => {
			if ((contact.kind ?? 'company') !== 'company') return false;
			if (companyName.length > 0 && normaliseLookupValue(contact.name ?? '') === companyName) {
				return true;
			}
			if (
				companyName.length > 0 &&
				normaliseLookupValue(getContactDisplayName(contact)) === companyName
			) {
				return true;
			}
			return businessKey.length > 0 && getComparableBusinessKey(contact) === businessKey;
		}) ?? null
	);
}

class SetupImportState {
	private sessionRevision = 0;

	digest = buildSetupImportSchemaDigest();
	sourceFileName = $state('');
	sourcePath = $state('');
	sourceContentHash = $state('');
	workbook: SetupImportWorkbook | null = $state(null);
	analysis: SetupImportAnalysis | null = $state(null);
	activeSheetId: string | null = $state(null);
	isLoading = $state(false);
	isImporting = $state(false);
	hasPendingImportRefresh = $state(false);
	sheetPreviews = new SvelteMap<string, SetupImportSheetPreview>();
	sheetImportModes = new SvelteMap<string, SetupImportDuplicateMode>();
	sheetDuplicateSummaries = new SvelteMap<string, SetupImportDuplicateSummary>();
	costCodeSystemSelections = new SvelteMap<string, string | null>();
	costCodeExistingUniverse = new SvelteMap<string, CostCode[]>();
	ignoredSheetIds = new SvelteMap<string, true>();
	rowFieldOverrides = new SvelteMap<string, string>();
	rowFieldDrafts = new SvelteMap<string, string>();
	skippedRows = new SvelteMap<string, true>();
	bulkValueRemaps = new SvelteMap<string, string>();
	resolvedPendingSystems = new SvelteMap<string, string>();
	importedSheetSignatures = new SvelteMap<string, string>();
	sheetImportResults = new SvelteMap<string, SetupImportSheetImportResult>();
	lastImportRunSummary: SetupImportRunSummary | null = $state(null);

	get hasAnalysis(): boolean {
		return !!this.analysis && !!this.workbook;
	}

	get sheets(): SetupImportSheetAnalysis[] {
		return this.analysis?.sheets ?? [];
	}

	get importableSheetCount(): number {
		return this.sheets.filter((sheet) => sheet.targetTable).length;
	}

	get readySheetCount(): number {
		return this.getImportPreflight().readySheetIds.length;
	}

	get hasBlockedSheets(): boolean {
		return this.sheets.some((sheet) => {
			if (!sheet.targetTable || this.isSheetExplicitlyIgnored(sheet.sheetId)) return false;
			if (this.getSheetSessionState(sheet.sheetId) === 'imported') return false;
			return sheet.readiness === 'blocked';
		});
	}

	get hasOutstandingSheets(): boolean {
		const preflight = this.getImportPreflight();
		return preflight.blockedSheetIds.length > 0 || preflight.dependencyErrors.length > 0;
	}

	get totalValidRowCount(): number {
		return this.sheets.reduce((total, sheet) => {
			const preview = this.sheetPreviews.get(sheet.sheetId);
			return (
				total + (this.isSheetReadyForImport(sheet.sheetId) ? (preview?.validRows.length ?? 0) : 0)
			);
		}, 0);
	}

	get importedSheetCount(): number {
		return this.sheets.filter((sheet) => this.getSheetSessionState(sheet.sheetId) === 'imported')
			.length;
	}

	get activeSheet(): SetupImportSheetAnalysis | null {
		if (!this.activeSheetId) return null;
		return this.getSheetAnalysis(this.activeSheetId);
	}

	get activeSheetPreview(): SetupImportSheetPreview | null {
		if (!this.activeSheetId) return null;
		return this.sheetPreviews.get(this.activeSheetId) ?? null;
	}

	clear(): void {
		this.sessionRevision += 1;
		this.sourceFileName = '';
		this.sourcePath = '';
		this.sourceContentHash = '';
		this.workbook = null;
		this.analysis = null;
		this.activeSheetId = null;
		this.isLoading = false;
		this.hasPendingImportRefresh = false;
		this.sheetPreviews.clear();
		this.sheetImportModes.clear();
		this.sheetDuplicateSummaries.clear();
		this.costCodeSystemSelections.clear();
		this.costCodeExistingUniverse.clear();
		this.ignoredSheetIds.clear();
		this.rowFieldOverrides.clear();
		this.rowFieldDrafts.clear();
		this.skippedRows.clear();
		this.bulkValueRemaps.clear();
		this.resolvedPendingSystems.clear();
		this.importedSheetSignatures.clear();
		this.sheetImportResults.clear();
		this.lastImportRunSummary = null;
	}

	private getSheetAnalysis(sheetId: string): SetupImportSheetAnalysis | null {
		return this.analysis?.sheets.find((sheet) => sheet.sheetId === sheetId) ?? null;
	}

	getSheet(sheetId: string): SetupImportSheetAnalysis | null {
		return this.getSheetAnalysis(sheetId);
	}

	isSheetExplicitlyIgnored(sheetId: string): boolean {
		return this.ignoredSheetIds.has(sheetId);
	}

	isSheetResolved(sheetId: string): boolean {
		if (this.getSheetSessionState(sheetId) === 'imported') return true;
		if (this.isSheetExplicitlyIgnored(sheetId)) return true;
		if (this.isSheetSatisfiedWithoutImport(sheetId)) return true;
		return this.isSheetReadyForImport(sheetId);
	}

	private getWorkbookSheet(sheetId: string): SetupImportWorkbookSheet | null {
		return this.workbook?.sheets.find((sheet) => sheet.sheetId === sheetId) ?? null;
	}

	private getTableDigest(
		tableId: SetupImportTargetTable | null
	): SetupImportSchemaTableDigest | null {
		if (!tableId) return null;
		return this.digest.tables.find((table) => table.id === tableId) ?? null;
	}

	private recomputeSheetState(sheet: SetupImportSheetAnalysis): void {
		const workbookSheet = this.getWorkbookSheet(sheet.sheetId);
		if ((workbookSheet?.headerIssues?.length ?? 0) > 0) {
			sheet.readiness = 'blocked';
			sheet.summary = 'Fix spreadsheet headers before import';
			sheet.unmatchedColumns = [];
			sheet.ignoredColumns = [];
			sheet.missingRequiredFields = [];
			return;
		}

		if (!sheet.targetTable) {
			sheet.readiness = 'ignored';
			sheet.summary = this.isSheetExplicitlyIgnored(sheet.sheetId)
				? 'Ignored'
				: 'Choose import table';
			sheet.unmatchedColumns = sheet.mappings
				.filter((mapping) => mapping.status === 'red')
				.map((mapping) => mapping.sourceColumn);
			sheet.ignoredColumns = [];
			sheet.missingRequiredFields = [];
			return;
		}

		const table = this.getTableDigest(sheet.targetTable);
		if (!table) {
			sheet.readiness = 'blocked';
			sheet.summary = 'Target table is unavailable';
			return;
		}

		const validFieldIds = new Set(table.fields.map((field) => field.id));
		for (const mapping of sheet.mappings) {
			if (mapping.targetField && !validFieldIds.has(mapping.targetField)) {
				mapping.targetField = null;
				mapping.status = 'red';
				mapping.confidence = 'low';
				mapping.reason = 'Needs review after target table change';
			}
		}

		sheet.unmatchedColumns = sheet.mappings
			.filter((mapping) => mapping.status === 'red')
			.map((mapping) => mapping.sourceColumn);
		sheet.ignoredColumns = sheet.mappings
			.filter((mapping) => mapping.status === 'ignored')
			.map((mapping) => mapping.sourceColumn);
		const { readiness, missingRequiredFields, unmatchedColumns, ignoredColumns } =
			deriveSetupImportSheetReadiness(table, sheet.mappings);
		sheet.missingRequiredFields = missingRequiredFields;
		sheet.unmatchedColumns = unmatchedColumns;
		sheet.ignoredColumns = ignoredColumns;
		const missingCostCodeSystem =
			sheet.targetTable === 'cost_codes' && !this.costCodeSystemSelections.get(sheet.sheetId);

		if (missingCostCodeSystem) {
			sheet.readiness = 'blocked';
		} else {
			sheet.readiness = readiness;
		}

		sheet.summary = table.label;
	}

	private getPendingCompanyContactsForPreview(sheetId: string) {
		return this.sheets.flatMap((sheet) => {
			if (sheet.sheetId === sheetId || sheet.targetTable !== 'contacts') return [];
			const preview = this.sheetPreviews.get(sheet.sheetId);
			return (preview?.validRows ?? [])
				.filter((row): row is ContactFormValues => (row as ContactFormValues).kind === 'company')
				.map((row) => ({
					id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}${buildSetupImportPendingContactCompanyKey(row)}`,
					kind: 'company' as const,
					display_name: row.display_name,
					name: row.name,
					company_name: row.company_name,
					business_id_value: row.business_id_value
				}));
		});
	}

	private async getCostCodeExistingCodesForPreview(sheetId: string): Promise<CostCode[]> {
		const sheet = this.getSheetAnalysis(sheetId);
		if (!sheet || sheet.targetTable !== 'cost_codes') return [];
		const selectedValue = this.costCodeSystemSelections.get(sheetId) ?? null;
		if (!selectedValue || selectedValue.startsWith(PENDING_SYSTEM_PREFIX)) return [];
		const systemId = selectedValue.startsWith(COST_CODE_SYSTEM_PREFIX)
			? selectedValue.slice(COST_CODE_SYSTEM_PREFIX.length)
			: selectedValue;
		if (!systemId) return [];
		const cached = this.costCodeExistingUniverse.get(systemId);
		if (cached) return cached;
		const session = this.sessionRevision;
		const costCodes = await dbService.getCostCodes(systemId, true);
		if (session === this.sessionRevision) this.costCodeExistingUniverse.set(systemId, costCodes);
		return costCodes;
	}

	private async refreshSheetPreview(sheetId: string): Promise<void> {
		const session = this.sessionRevision;
		const sheet = this.getSheetAnalysis(sheetId);
		const workbookSheet = this.getWorkbookSheet(sheetId);
		if (!sheet || !workbookSheet) return;
		this.recomputeSheetState(sheet);
		const existingCompanyContacts = [
			...contactsState.list,
			...this.getPendingCompanyContactsForPreview(sheetId)
		];
		const previewOptions = {
			rowOverrides: this.getSheetRowOverrides(sheetId),
			skippedRowNumbers: this.getSkippedRowNumbers(sheetId),
			workspaceCountryCode: workspaceState.countryCode || 'AU',
			...(existingCompanyContacts.length > 0 ? { existingCompanyContacts } : {})
		};
		const selectedValue = this.costCodeSystemSelections.get(sheetId) ?? null;
		const needsExistingCostCodes =
			sheet.targetTable === 'cost_codes' &&
			!!selectedValue &&
			!selectedValue.startsWith(PENDING_SYSTEM_PREFIX);
		if (!needsExistingCostCodes) {
			this.sheetPreviews.set(
				sheetId,
				previewSetupImportSheet(workbookSheet, sheet, previewOptions)
			);
			this.refreshSheetDuplicateSummary(sheetId);
			return;
		}

		const costCodeExistingCodes = await this.getCostCodeExistingCodesForPreview(sheetId);
		if (session !== this.sessionRevision) return;
		this.sheetPreviews.set(
			sheetId,
			previewSetupImportSheet(workbookSheet, sheet, {
				...previewOptions,
				costCodeExistingCodes
			})
		);
		this.refreshSheetDuplicateSummary(sheetId);
	}

	private async refreshAllPreviews(): Promise<void> {
		const session = this.sessionRevision;
		await Promise.all(this.sheets.map((sheet) => this.refreshSheetPreview(sheet.sheetId)));
		if (session !== this.sessionRevision) return;
		await Promise.all(
			this.sheets
				.filter((sheet) => sheet.targetTable === 'contacts')
				.map((sheet) => this.refreshSheetPreview(sheet.sheetId))
		);
	}

	private ensureCostCodeSelections(): void {
		for (const sheet of this.sheets) {
			if (sheet.targetTable !== 'cost_codes') continue;
			const options = this.getCostCodeSystemOptions(sheet.sheetId);
			const pendingOptions = options.filter((option) => option.kind === 'pending');
			if (pendingOptions.length === 1) {
				this.costCodeSystemSelections.set(sheet.sheetId, pendingOptions[0].value);
				continue;
			}
			if (this.costCodeSystemSelections.get(sheet.sheetId)) continue;
			if (options.length === 1) {
				this.costCodeSystemSelections.set(sheet.sheetId, options[0].value);
			}
		}
	}

	private ensureSheetImportModes(): void {
		for (const sheet of this.sheets) {
			if (this.sheetImportModes.has(sheet.sheetId)) continue;
			this.sheetImportModes.set(sheet.sheetId, 'keep_existing');
		}
	}

	private async ensureClassificationSystemsLoadedForImport(): Promise<void> {
		const needsClassificationSystems = this.sheets.some(
			(sheet) => sheet.targetTable === 'cost_codes'
		);
		if (!needsClassificationSystems || classificationSystemsState.list.length > 0) return;
		await classificationSystemsState.hydrate();
	}

	private findMatchingCustomer(row: ContactFormValues): ContactFormValues | null {
		const normalizedName = normaliseLookupValue(row.display_name || row.name);
		const existing =
			contactsState.list.find(
				(customer) =>
					normaliseLookupValue(customer.display_name || customer.name) === normalizedName
			) ?? null;
		return existing
			? {
					kind: existing.kind ?? 'company',
					country_code: existing.country_code,
					display_name: existing.display_name || existing.name,
					name: existing.name,
					company_name: existing.company_name ?? existing.name,
					person_first_name: existing.person_first_name ?? '',
					person_last_name: existing.person_last_name ?? '',
					role_title: existing.role_title ?? '',
					linked_company_id: existing.linked_company_id ?? '',
					is_primary_company_contact: existing.is_primary_company_contact ?? false,
					contact_name: existing.contact_name ?? '',
					email: existing.email ?? '',
					website: existing.website ?? '',
					phone: existing.phone ?? '',
					phone_country_code: existing.phone_country_code ?? existing.country_code,
					phone_e164: existing.phone_e164 ?? '',
					abn: existing.abn ?? '',
					business_id_label: existing.business_id_label ?? 'Business ID',
					business_id_value: existing.business_id_value ?? '',
					tax_id_label: existing.tax_id_label ?? 'Tax ID',
					tax_id_value: existing.tax_id_value ?? '',
					address: existing.address ?? '',
					notes: existing.notes ?? '',
					custom_role_label: existing.custom_role_label ?? '',
					roles: existing.roles ?? ['customer'],
					tags: existing.tags ?? [],
					is_active: existing.is_active ?? true
				}
			: null;
	}

	private countSheetDuplicateMatches(
		sheet: SetupImportSheetAnalysis,
		preview: SetupImportSheetPreview
	): number | null {
		if (!sheet.targetTable) return null;

		switch (sheet.targetTable) {
			case 'contacts':
				return (preview.validRows as ContactFormValues[]).filter((row) =>
					contactsState.findMatchingContact(row)
				).length;
			case 'materials':
				return (preview.validRows as MaterialCatalogItemFormValues[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return materialsState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return materialsState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'labour_rates':
				return (preview.validRows as LabourRateCardFormValues[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return labourRatesState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return labourRatesState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'equipment_rates':
				return (preview.validRows as EquipmentRateCardFormValues[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return equipmentRatesState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return equipmentRatesState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'subcontract_rates':
				return (preview.validRows as SubcontractRateCardFormValues[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return subcontractRatesState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return subcontractRatesState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'cost_presets':
				return (preview.validRows as SetupImportCostPresetRow[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return costComponentPresetsState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return costComponentPresetsState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'estimate_templates':
				return (preview.validRows as SetupImportEstimateTemplateRow[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return estimateTemplatesState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return estimateTemplatesState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'project_structure_templates':
				return (preview.validRows as SetupImportProjectStructureTemplateRow[]).filter((row) => {
					const normalizedCode = normaliseLookupValue(row.code);
					if (normalizedCode) {
						return projectStructureTemplatesState.list.some(
							(item) => normaliseLookupValue(item.code) === normalizedCode
						);
					}
					return projectStructureTemplatesState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					);
				}).length;
			case 'classification_systems':
				return (preview.validRows as ClassificationSystemFormValues[]).filter((row) =>
					classificationSystemsState.list.some(
						(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
					)
				).length;
			case 'cost_codes': {
				const selectedValue = this.costCodeSystemSelections.get(sheet.sheetId) ?? null;
				if (!selectedValue || selectedValue.startsWith(PENDING_SYSTEM_PREFIX)) return 0;
				const existingSystemId = selectedValue.startsWith(COST_CODE_SYSTEM_PREFIX)
					? selectedValue.slice(COST_CODE_SYSTEM_PREFIX.length)
					: selectedValue;
				if (classificationSystemsState.activeSystemId !== existingSystemId) return null;
				return (preview.validRows as CostCodeFormValues[]).filter((row) =>
					classificationSystemsState.costCodes.some(
						(item) => normaliseLookupValue(item.code) === normaliseLookupValue(row.code)
					)
				).length;
			}
		}
	}

	private refreshSheetDuplicateSummary(sheetId: string): void {
		const sheet = this.getSheetAnalysis(sheetId);
		const preview = this.sheetPreviews.get(sheetId);
		if (!sheet || !preview || !sheet.targetTable || preview.validRows.length === 0) {
			this.sheetDuplicateSummaries.delete(sheetId);
			return;
		}

		const matchedRowCount = this.countSheetDuplicateMatches(sheet, preview);
		if (matchedRowCount === null) {
			this.sheetDuplicateSummaries.delete(sheetId);
			return;
		}

		this.sheetDuplicateSummaries.set(sheetId, {
			matchedRowCount,
			newRowCount: Math.max(preview.validRows.length - matchedRowCount, 0)
		});
	}

	private getSheetRowOverrides(sheetId: string): SetupImportRowFieldOverrides {
		const overrides: SetupImportRowFieldOverrides = {};
		for (const [key, value] of this.rowFieldOverrides.entries()) {
			if (!key.startsWith(`${sheetId}:`)) continue;
			const [, rawRowNumber, ...fieldParts] = key.split(':');
			const rowNumber = Number(rawRowNumber);
			if (Number.isNaN(rowNumber) || fieldParts.length === 0) continue;
			const fieldId = fieldParts.join(':');
			overrides[rowNumber] ??= {};
			overrides[rowNumber][fieldId] = value;
		}
		return overrides;
	}

	private clearSheetRowOverrides(sheetId: string): void {
		for (const key of [...this.rowFieldOverrides.keys()]) {
			if (key.startsWith(`${sheetId}:`)) this.rowFieldOverrides.delete(key);
		}
	}

	private clearSheetRowDrafts(sheetId: string): void {
		for (const key of [...this.rowFieldDrafts.keys()]) {
			if (key.startsWith(`${sheetId}:`)) this.rowFieldDrafts.delete(key);
		}
	}

	private clearSkippedRows(sheetId: string): void {
		for (const key of [...this.skippedRows.keys()]) {
			if (key.startsWith(`${sheetId}:`)) this.skippedRows.delete(key);
		}
	}

	private clearSheetBulkRemaps(sheetId: string): void {
		for (const key of [...this.bulkValueRemaps.keys()]) {
			if (key.startsWith(`${sheetId}:`)) this.bulkValueRemaps.delete(key);
		}
	}

	private clearResolvedPendingSystemsForSheet(sheetId: string): void {
		for (const key of [...this.resolvedPendingSystems.keys()]) {
			if (key.startsWith(`${PENDING_SYSTEM_PREFIX}${sheetId}:`)) {
				this.resolvedPendingSystems.delete(key);
			}
		}
	}

	private clearSheetRemediationState(sheetId: string): void {
		this.clearSheetRowOverrides(sheetId);
		this.clearSheetRowDrafts(sheetId);
		this.clearSkippedRows(sheetId);
		this.clearSheetBulkRemaps(sheetId);
		this.clearResolvedPendingSystemsForSheet(sheetId);
	}

	getSheetImportMode(sheetId: string): SetupImportDuplicateMode {
		return this.sheetImportModes.get(sheetId) ?? 'keep_existing';
	}

	setSheetImportMode(sheetId: string, mode: SetupImportDuplicateMode): void {
		this.sheetImportModes.set(sheetId, mode);
	}

	getSheetDuplicateSummary(sheetId: string): SetupImportDuplicateSummary | null {
		return this.sheetDuplicateSummaries.get(sheetId) ?? null;
	}

	private buildSheetImportSignature(sheetId: string): string | null {
		const sheet = this.getSheetAnalysis(sheetId);
		const preview = this.sheetPreviews.get(sheetId);
		if (!sheet || !sheet.targetTable || !preview) return null;

		return JSON.stringify({
			targetTable: sheet.targetTable,
			importMode: this.getSheetImportMode(sheetId),
			systemSelection: this.costCodeSystemSelections.get(sheetId) ?? null,
			rowOverrides: this.getSheetRowOverrides(sheetId),
			mappings: sheet.mappings.map((mapping) => ({
				sourceColumn: mapping.sourceColumn,
				targetField: mapping.targetField,
				status: mapping.status
			})),
			validRows: preview.validRows
		});
	}

	getSheetSessionState(sheetId: string): SetupImportSheetSessionState {
		const importedSignature = this.importedSheetSignatures.get(sheetId);
		if (!importedSignature) return 'not_imported';
		return importedSignature === this.buildSheetImportSignature(sheetId)
			? 'imported'
			: 'dirty_after_import';
	}

	getSheetImportResult(sheetId: string): SetupImportSheetImportResult | null {
		return this.sheetImportResults.get(sheetId) ?? null;
	}

	private buildSheetImportResult(sheetId: string): SetupImportSheetImportResult | null {
		const sheet = this.getSheetAnalysis(sheetId);
		const preview = this.sheetPreviews.get(sheetId);
		if (!sheet || !sheet.targetTable || !preview) return null;

		const duplicateSummary = this.getSheetDuplicateSummary(sheetId);
		const importMode = this.getSheetImportMode(sheetId);
		const validRowCount = preview.validRows.length;
		const matchedRowCount = duplicateSummary?.matchedRowCount ?? 0;
		const newRowCount = duplicateSummary?.newRowCount ?? validRowCount;
		const created = Math.max(newRowCount, 0);
		const updated = importMode === 'update_matched' ? matchedRowCount : 0;
		const skipped = importMode === 'keep_existing' ? matchedRowCount : 0;

		return {
			sheetId,
			sheetName: sheet.sheetName,
			targetTable: sheet.targetTable,
			created,
			updated,
			skipped,
			skippedRows: preview.skippedRowCount ?? 0,
			validRowCount,
			importedAt: new Date().toISOString()
		};
	}

	private getSheetsInImportOrder(): SetupImportSheetAnalysis[] {
		return [...this.sheets].sort((left, right) => {
			const leftIndex = left.targetTable ? SHEET_IMPORT_ORDER.indexOf(left.targetTable) : 999;
			const rightIndex = right.targetTable ? SHEET_IMPORT_ORDER.indexOf(right.targetTable) : 999;
			return leftIndex - rightIndex;
		});
	}

	setActiveSheet(sheetId: string): void {
		this.activeSheetId = sheetId;
	}

	async loadFile(
		input: ParseSetupImportFileInput & {
			sourcePath: string;
		}
	): Promise<void> {
		if (this.isImporting) return;
		const session = ++this.sessionRevision;
		this.isLoading = true;
		try {
			const sourceBytes = input.bytes ?? new TextEncoder().encode(input.text ?? '');
			const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(sourceBytes).buffer);
			if (session !== this.sessionRevision) return;
			const sourceContentHash = Array.from(new Uint8Array(hash), (byte) =>
				byte.toString(16).padStart(2, '0')
			).join('');
			const { workbook, analysis } = await loadSetupImportFileAnalysis(input);
			if (session !== this.sessionRevision) return;
			this.sourceFileName = input.fileName;
			this.sourcePath = input.sourcePath;
			this.sourceContentHash = sourceContentHash;
			this.workbook = workbook;
			this.analysis = analysis;
			this.sheetPreviews.clear();
			this.sheetImportModes.clear();
			this.sheetDuplicateSummaries.clear();
			this.costCodeSystemSelections.clear();
			this.costCodeExistingUniverse.clear();
			this.ignoredSheetIds.clear();
			this.rowFieldOverrides.clear();
			this.rowFieldDrafts.clear();
			this.skippedRows.clear();
			this.bulkValueRemaps.clear();
			this.resolvedPendingSystems.clear();
			this.importedSheetSignatures.clear();
			this.sheetImportResults.clear();
			this.lastImportRunSummary = null;
			this.hasPendingImportRefresh = false;
			this.ensureSheetImportModes();
			await this.ensureClassificationSystemsLoadedForImport();
			if (session !== this.sessionRevision) return;
			await this.refreshAllPreviews();
			if (session !== this.sessionRevision) return;
			// Pending classification systems only become selectable after previews exist.
			this.ensureCostCodeSelections();
			// Recompute readiness once cost-code system selection has been resolved.
			await this.refreshAllPreviews();
			if (session !== this.sessionRevision) return;
			this.activeSheetId =
				this.getSheetsInImportOrder().find((sheet) => sheet.targetTable)?.sheetId ??
				analysis.sheets[0]?.sheetId ??
				null;
			log.info('Loaded setup import workbook', {
				fileName: input.fileName,
				sheetCount: workbook.sheets.length,
				readySheetCount: analysis.sheets.filter((sheet) => sheet.readiness === 'ready').length,
				ignoredSheetCount: analysis.workbookSummary.ignoredSheetCount
			});
		} catch (error) {
			if (session !== this.sessionRevision) return;
			await errorState.catchError(error, `Analyse setup import ${input.fileName}`);
			throw error;
		} finally {
			if (session === this.sessionRevision) this.isLoading = false;
		}
	}

	updateSheetTargetTable(sheetId: string, targetTable: SetupImportTargetTable | null): void {
		const sheet = this.getSheetAnalysis(sheetId);
		const workbookSheet = this.getWorkbookSheet(sheetId);
		if (!sheet) return;

		if (!targetTable) {
			this.ignoredSheetIds.set(sheetId, true);
			sheet.targetTable = null;
			sheet.mappings = sheet.mappings.map((mapping) => ({
				...mapping,
				targetField: null,
				status: 'ignored',
				confidence: 'low',
				reason: buildIgnoredMappingReason()
			}));
		} else if (workbookSheet) {
			this.ignoredSheetIds.delete(sheetId);
			const suggestedSheet = suggestSetupImportSheetForTargetTable(
				workbookSheet,
				sheet,
				targetTable,
				this.digest
			);
			Object.assign(sheet, suggestedSheet);
		} else {
			this.ignoredSheetIds.delete(sheetId);
			sheet.targetTable = targetTable;
		}

		this.clearSheetRemediationState(sheetId);
		void this.refreshSheetPreview(sheetId);
	}

	updateSheetMapping(
		sheetId: string,
		sourceColumn: string,
		targetField: string | null,
		options: { ignored?: boolean } = {}
	): void {
		const sheet = this.getSheetAnalysis(sheetId);
		if (!sheet) return;

		for (const mapping of sheet.mappings) {
			if (mapping.sourceColumn === sourceColumn) {
				mapping.targetField = targetField;
				mapping.status = targetField ? 'green' : options.ignored ? 'ignored' : 'red';
				mapping.confidence = targetField ? 'high' : 'low';
				mapping.reason = targetField
					? 'Confirmed by user'
					: options.ignored
						? buildIgnoredMappingReason()
						: 'Needs review';
				continue;
			}
			if (targetField && mapping.targetField === targetField) {
				mapping.targetField = null;
				mapping.status = 'red';
				mapping.confidence = 'low';
				mapping.reason = 'Removed after another column was confirmed';
			}
		}

		this.clearSheetRemediationState(sheetId);
		void this.refreshSheetPreview(sheetId);
	}

	confirmSuggestedMapping(sheetId: string, sourceColumn: string): void {
		const sheet = this.getSheetAnalysis(sheetId);
		if (!sheet) return;

		const mapping = sheet.mappings.find((entry) => entry.sourceColumn === sourceColumn);
		if (!mapping?.targetField || mapping.status !== 'yellow') return;

		mapping.status = 'green';
		mapping.confidence = 'high';
		mapping.reason = 'Confirmed by user';
		this.clearSheetRemediationState(sheetId);
		void this.refreshSheetPreview(sheetId);
	}

	setCostCodeSystemSelection(sheetId: string, value: string | null): void {
		if (value) {
			this.costCodeSystemSelections.set(sheetId, value);
		} else {
			this.costCodeSystemSelections.delete(sheetId);
		}
		this.clearSheetRemediationState(sheetId);
		void this.refreshSheetPreview(sheetId);
	}

	updateRowFieldOverride(sheetId: string, rowNumber: number, fieldId: string, value: string): void {
		const key = buildRowOverrideKey(sheetId, rowNumber, fieldId);
		if (value.trim()) {
			this.rowFieldOverrides.set(key, value);
		} else {
			this.rowFieldOverrides.delete(key);
		}
		void this.refreshSheetPreview(sheetId);
	}

	setRowFieldDraft(sheetId: string, rowNumber: number, fieldId: string, value: string): void {
		const key = buildRowOverrideKey(sheetId, rowNumber, fieldId);
		this.rowFieldDrafts.set(key, value);
	}

	getRowFieldDraft(sheetId: string, rowNumber: number, fieldId: string): string {
		return this.rowFieldDrafts.get(buildRowOverrideKey(sheetId, rowNumber, fieldId)) ?? '';
	}

	hasRowFieldDraft(sheetId: string, rowNumber: number, fieldId: string): boolean {
		return this.rowFieldDrafts.has(buildRowOverrideKey(sheetId, rowNumber, fieldId));
	}

	hasRowDrafts(sheetId: string, rowNumber: number): boolean {
		const prefix = `${sheetId}:${rowNumber}:`;
		return [...this.rowFieldDrafts.keys()].some((key) => key.startsWith(prefix));
	}

	hasRowRemediationState(sheetId: string, rowNumber: number): boolean {
		const prefix = `${sheetId}:${rowNumber}:`;
		return (
			[...this.rowFieldDrafts.keys()].some((key) => key.startsWith(prefix)) ||
			[...this.rowFieldOverrides.keys()].some((key) => key.startsWith(prefix)) ||
			this.isRowSkipped(sheetId, rowNumber)
		);
	}

	applyRowFix(sheetId: string, rowNumber: number): void {
		const prefix = `${sheetId}:${rowNumber}:`;
		for (const [key, value] of this.rowFieldDrafts.entries()) {
			if (!key.startsWith(prefix)) continue;
			if (value.trim()) {
				this.rowFieldOverrides.set(key, value);
			} else {
				this.rowFieldOverrides.delete(key);
			}
			this.rowFieldDrafts.delete(key);
		}
		this.skippedRows.delete(buildRowSkipKey(sheetId, rowNumber));
		void this.refreshSheetPreview(sheetId);
	}

	resetRowFix(sheetId: string, rowNumber: number): void {
		const prefix = `${sheetId}:${rowNumber}:`;
		for (const key of [...this.rowFieldDrafts.keys()]) {
			if (key.startsWith(prefix)) this.rowFieldDrafts.delete(key);
		}
		for (const key of [...this.rowFieldOverrides.keys()]) {
			if (key.startsWith(prefix)) this.rowFieldOverrides.delete(key);
		}
		this.skippedRows.delete(buildRowSkipKey(sheetId, rowNumber));
		void this.refreshSheetPreview(sheetId);
	}

	isRowSkipped(sheetId: string, rowNumber: number): boolean {
		return this.skippedRows.has(buildRowSkipKey(sheetId, rowNumber));
	}

	skipRow(sheetId: string, rowNumber: number): void {
		this.skippedRows.set(buildRowSkipKey(sheetId, rowNumber), true);
		void this.refreshSheetPreview(sheetId);
	}

	unskipRow(sheetId: string, rowNumber: number): void {
		this.skippedRows.delete(buildRowSkipKey(sheetId, rowNumber));
		void this.refreshSheetPreview(sheetId);
	}

	getSkippedRowNumbers(sheetId: string): number[] {
		return [...this.skippedRows.keys()]
			.filter((key) => key.startsWith(`${sheetId}:`))
			.map((key) => Number(key.slice(`${sheetId}:`.length)))
			.filter((rowNumber) => !Number.isNaN(rowNumber))
			.sort((left, right) => left - right);
	}

	getRowFieldOverride(sheetId: string, rowNumber: number, fieldId: string): string {
		return this.rowFieldOverrides.get(buildRowOverrideKey(sheetId, rowNumber, fieldId)) ?? '';
	}

	getRepeatedValueIssues(sheetId: string): SetupImportRepeatedValueIssue[] {
		const preview = this.sheetPreviews.get(sheetId);
		if (!preview || preview.rowValidationDeferred || preview.errors.length === 0) return [];
		const repeatableFields = new Set([
			'country_code',
			'type',
			'unit',
			'is_default',
			'is_active',
			'is_primary_company_contact',
			'kind'
		]);
		const grouped = new SvelteMap<string, SetupImportRepeatedValueIssue>();
		for (const issue of preview.errors) {
			for (const fieldIssue of issue.fieldIssues) {
				if (!repeatableFields.has(fieldIssue.fieldId)) continue;
				const rawValue = (issue.mappedValues[fieldIssue.fieldId] ?? '').trim();
				if (!rawValue) continue;
				const key = `${fieldIssue.fieldId}:${rawValue}`;
				const existing = grouped.get(key);
				if (existing) {
					existing.rowNumbers.push(issue.rowNumber);
					continue;
				}
				grouped.set(key, {
					fieldId: fieldIssue.fieldId,
					rawValue,
					rowNumbers: [issue.rowNumber]
				});
			}
		}
		return [...grouped.values()].filter((issue) => issue.rowNumbers.length > 1);
	}

	getBulkValueRemap(sheetId: string, fieldId: string, rawValue: string): string {
		return this.bulkValueRemaps.get(buildBulkValueRemapKey(sheetId, fieldId, rawValue)) ?? '';
	}

	applyBulkValueRemap(sheetId: string, fieldId: string, rawValue: string, value: string): void {
		const preview = this.sheetPreviews.get(sheetId);
		if (!preview) return;
		for (const issue of preview.errors) {
			const issueValue = (issue.mappedValues[fieldId] ?? '').trim();
			if (issueValue !== rawValue) continue;
			if (!issue.fieldIssues.some((fieldIssue) => fieldIssue.fieldId === fieldId)) continue;
			const key = buildRowOverrideKey(sheetId, issue.rowNumber, fieldId);
			if (value.trim()) {
				this.rowFieldOverrides.set(key, value);
			} else {
				this.rowFieldOverrides.delete(key);
			}
		}
		this.bulkValueRemaps.set(buildBulkValueRemapKey(sheetId, fieldId, rawValue), value);
		void this.refreshSheetPreview(sheetId);
	}

	getTargetFieldOptions(sheetId: string): string[] {
		const sheet = this.getSheetAnalysis(sheetId);
		const table = this.getTableDigest(sheet?.targetTable ?? null);
		if (!table) return [];
		return table.fields.map((field) => field.id);
	}

	getCostCodeSystemOptions(sheetId: string): SetupImportSystemOption[] {
		if (this.getSheetAnalysis(sheetId)?.targetTable !== 'cost_codes') return [];

		const existingOptions: SetupImportSystemOption[] = classificationSystemsState.list.map(
			(system) => ({
				value: buildExistingSystemValue(system.id),
				label: `Existing · ${system.name}`,
				kind: 'existing'
			})
		);

		const pendingOptions: SetupImportSystemOption[] = [];
		for (const sheet of this.sheets) {
			if (sheet.targetTable !== 'classification_systems') continue;
			const preview = this.sheetPreviews.get(sheet.sheetId);
			const rows = (preview?.validRows ?? []) as ClassificationSystemFormValues[];
			rows.forEach((row, index) => {
				pendingOptions.push({
					value: buildPendingSystemValue(sheet.sheetId, index),
					label: `New import · ${row.name}`,
					kind: 'pending'
				});
			});
		}

		return [...existingOptions, ...pendingOptions];
	}

	isSheetImportable(sheetId: string): boolean {
		const sheet = this.getSheetAnalysis(sheetId);
		const preview = this.sheetPreviews.get(sheetId);
		if (!sheet || !sheet.targetTable || !preview) return false;
		if (sheet.readiness !== 'ready') return false;
		if (preview.errors.length > 0) return false;
		return preview.validRows.length > 0;
	}

	private isSheetSatisfiedWithoutImport(sheetId: string): boolean {
		const sheet = this.getSheetAnalysis(sheetId);
		const preview = this.sheetPreviews.get(sheetId);
		if (!sheet || !sheet.targetTable || !preview) return false;
		if (preview.rowValidationDeferred) return false;
		return (
			preview.errors.length === 0 &&
			preview.validRows.length === 0 &&
			(preview.skippedRowCount ?? 0) > 0
		);
	}

	isSheetReadyForImport(sheetId: string): boolean {
		return this.isSheetImportable(sheetId) && this.getSheetSessionState(sheetId) !== 'imported';
	}

	private buildImportPreflight(): SetupImportPreflight {
		const readySheetIds: string[] = [];
		const blockedSheetIds: string[] = [];
		const dependencyErrors: SetupImportDependencyIssue[] = [];

		for (const sheet of this.sheets) {
			if (this.isSheetExplicitlyIgnored(sheet.sheetId)) continue;
			if (this.getSheetSessionState(sheet.sheetId) === 'imported') continue;
			if (this.isSheetSatisfiedWithoutImport(sheet.sheetId)) continue;
			if (this.isSheetReadyForImport(sheet.sheetId)) {
				readySheetIds.push(sheet.sheetId);
			} else {
				blockedSheetIds.push(sheet.sheetId);
			}
		}

		for (const sheetId of readySheetIds) {
			const sheet = this.getSheetAnalysis(sheetId);
			if (!sheet || sheet.targetTable !== 'cost_codes') continue;
			const selectedValue = this.costCodeSystemSelections.get(sheetId) ?? null;
			if (!selectedValue) {
				dependencyErrors.push({
					sheetId,
					message: 'Choose the classification system before importing cost codes.'
				});
				continue;
			}
			if (!selectedValue.startsWith(PENDING_SYSTEM_PREFIX)) continue;

			const resolvedImportedId = this.resolvedPendingSystems.get(selectedValue);
			if (resolvedImportedId) continue;

			const pending = parsePendingSystemValue(selectedValue);
			const targetSheet = pending ? this.getSheetAnalysis(pending.sheetId) : null;
			const targetPreview = pending ? this.sheetPreviews.get(pending.sheetId) : null;
			const targetReady =
				!!targetSheet &&
				targetSheet.targetTable === 'classification_systems' &&
				this.isSheetReadyForImport(targetSheet.sheetId) &&
				(targetPreview?.validRows[pending?.rowIndex ?? -1] ?? null) !== null;
			if (!targetReady) {
				const existingBlocked = blockedSheetIds.includes(sheetId);
				if (!existingBlocked) blockedSheetIds.push(sheetId);
				const readyIndex = readySheetIds.indexOf(sheetId);
				if (readyIndex >= 0) readySheetIds.splice(readyIndex, 1);
				dependencyErrors.push({
					sheetId,
					message: 'The selected classification system is not ready yet. Import the system first.'
				});
			}
		}

		const companyCandidates = new SvelteMap<string, Contact>();
		for (const contact of contactsState.list) {
			if (contact.kind === 'company') companyCandidates.set(contact.id, contact);
		}
		for (const sheetId of readySheetIds) {
			const sheet = this.getSheetAnalysis(sheetId);
			if (sheet?.targetTable !== 'contacts') continue;
			const preview = this.sheetPreviews.get(sheetId);
			for (const row of (preview?.validRows ?? []) as ContactFormValues[]) {
				if (row.kind !== 'company') continue;
				const existing = findMatchingSetupImportContact([...companyCandidates.values()], row);
				const id =
					existing?.id ??
					`${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}${buildSetupImportPendingContactCompanyKey(row)}`;
				companyCandidates.set(id, buildContactCandidate(id, row));
			}
		}
		for (const sheetId of [...readySheetIds]) {
			const sheet = this.getSheetAnalysis(sheetId);
			if (
				!sheet ||
				!['materials', 'labour_rates', 'equipment_rates', 'subcontract_rates'].includes(
					sheet.targetTable ?? ''
				)
			)
				continue;
			const preview = this.sheetPreviews.get(sheetId);
			for (const row of (preview?.validRows ?? []) as Array<{ company_names?: string[] }>) {
				for (const companyName of row.company_names ?? []) {
					const matches = findSetupImportCompanyMatches(companyName, [
						...companyCandidates.values()
					]);
					if (matches.length === 1) continue;
					if (!blockedSheetIds.includes(sheetId)) blockedSheetIds.push(sheetId);
					const readyIndex = readySheetIds.indexOf(sheetId);
					if (readyIndex >= 0) readySheetIds.splice(readyIndex, 1);
					dependencyErrors.push({
						sheetId,
						message:
							matches.length === 0
								? `Company "${companyName}" was not found. Import or create it before linking this catalogue row.`
								: `Company "${companyName}" matches more than one record. Use a unique company name or business ID.`
					});
					break;
				}
				if (blockedSheetIds.includes(sheetId)) break;
			}
		}

		const defaultClassificationRows = this.sheets.flatMap((sheet) => {
			if (
				this.isSheetExplicitlyIgnored(sheet.sheetId) ||
				this.getSheetSessionState(sheet.sheetId) === 'imported' ||
				sheet.targetTable !== 'classification_systems'
			) {
				return [];
			}
			const preview = this.sheetPreviews.get(sheet.sheetId);
			if (!preview) return [];
			return (preview.validRows as ClassificationSystemFormValues[])
				.filter((row) => row.is_default)
				.map((row) => ({ sheetId: sheet.sheetId, row }));
		});
		if (defaultClassificationRows.length > 1) {
			for (const { sheetId } of defaultClassificationRows) {
				if (!blockedSheetIds.includes(sheetId)) blockedSheetIds.push(sheetId);
				const readyIndex = readySheetIds.indexOf(sheetId);
				if (readyIndex >= 0) readySheetIds.splice(readyIndex, 1);
			}
			dependencyErrors.push({
				sheetId: defaultClassificationRows[0]?.sheetId ?? '',
				message:
					'Only one imported classification system can be marked as the default. Clear the extra default flags before importing.'
			});
		} else if (defaultClassificationRows.length === 1) {
			const existingDefault = classificationSystemsState.list.find((system) => system.is_default);
			const importedDefault = defaultClassificationRows[0];
			const matchesExistingDefault =
				!!existingDefault &&
				normaliseLookupValue(existingDefault.name) ===
					normaliseLookupValue(importedDefault.row.name);
			if (existingDefault && !matchesExistingDefault) {
				const { sheetId } = importedDefault;
				if (!blockedSheetIds.includes(sheetId)) blockedSheetIds.push(sheetId);
				const readyIndex = readySheetIds.indexOf(sheetId);
				if (readyIndex >= 0) readySheetIds.splice(readyIndex, 1);
				dependencyErrors.push({
					sheetId,
					message: `The workspace already has default classification system "${existingDefault.name}". Clear it in Classification Systems before importing a different default.`
				});
			}
		}

		return {
			canApply: readySheetIds.length > 0,
			readySheetIds,
			blockedSheetIds,
			dependencyErrors,
			remediationRequired: blockedSheetIds.length > 0
		};
	}

	getImportPreflight(): SetupImportPreflight {
		return this.buildImportPreflight();
	}

	private async buildApplySession(): Promise<SetupImportApplyBuild> {
		const payload: Omit<SetupImportSessionPayload, 'audit'> = {
			contacts: [],
			materials: [],
			labourRates: [],
			equipmentRates: [],
			subcontractRates: [],
			costPresets: [],
			estimateTemplates: [],
			projectStructureTemplates: [],
			classificationSystems: [],
			costCodes: [],
			companyCatalogueLinks: []
		};
		const signatures = new SvelteMap<string, string>();
		const resolvedPendingSystems = new SvelteMap<string, string>(this.resolvedPendingSystems);
		const sheetResults: SetupImportSheetImportResult[] = [];

		const contactUniverse = [...contactsState.list];
		const materialUniverse = materialsState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name
		}));
		const labourUniverse = labourRatesState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name,
			category: item.category ?? '',
			work_center: item.work_center ?? ''
		}));
		const equipmentUniverse = equipmentRatesState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name,
			category: item.category ?? '',
			work_center: item.work_center ?? ''
		}));
		const subcontractUniverse = subcontractRatesState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name
		}));
		const pendingCompanyIds = new SvelteMap<string, string>();
		for (const sheet of this.getSheetsInImportOrder()) {
			if (sheet.targetTable !== 'contacts' || !this.isSheetReadyForImport(sheet.sheetId)) continue;
			const preview = this.sheetPreviews.get(sheet.sheetId);
			for (const row of (preview?.validRows ?? []) as ContactFormValues[]) {
				if (row.kind !== 'company') continue;
				const key = buildSetupImportPendingContactCompanyKey(row);
				if (pendingCompanyIds.has(key)) continue;
				const existingContact = findMatchingSetupImportContact(contactUniverse, row);
				pendingCompanyIds.set(key, existingContact?.id ?? crypto.randomUUID());
			}
		}
		const presetUniverse = costComponentPresetsState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name
		}));
		const templateUniverse = estimateTemplatesState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name
		}));
		const projectStructureTemplateUniverse = projectStructureTemplatesState.list.map((item) => ({
			id: item.id,
			code: item.code ?? '',
			name: item.name
		}));
		const classificationUniverse = classificationSystemsState.list.map((item) => ({
			id: item.id,
			name: item.name
		}));
		const costCodeUniverseBySystem = new SvelteMap<string, CostCode[]>();

		for (const sheet of this.getSheetsInImportOrder()) {
			if (!this.isSheetReadyForImport(sheet.sheetId) || !sheet.targetTable) continue;
			const preview = this.sheetPreviews.get(sheet.sheetId);
			if (!preview || preview.validRows.length === 0) continue;

			let created = 0;
			let updated = 0;
			let skipped = 0;
			const importMode = this.getSheetImportMode(sheet.sheetId);
			const mappedFields = sheet.mappings
				.filter((mapping) => mapping.targetField && mapping.status !== 'ignored')
				.map((mapping) => mapping.targetField!);

			switch (sheet.targetTable) {
				case 'contacts': {
					const companiesWithExpandedPeople = new Set(
						(preview.validRows as ContactFormValues[])
							.filter((row) => row.kind === 'person')
							.map((row) => row.linked_company_id)
							.filter((id) => id.startsWith(SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX))
					);
					for (const rawRow of preview.validRows as ContactFormValues[]) {
						const resolvedRow = resolvePendingCompanyLinkForSetupImport(
							normaliseSetupImportContactInput(rawRow),
							pendingCompanyIds
						);
						const existingContact = findMatchingSetupImportContact(contactUniverse, resolvedRow);
						const pendingCompanyKey =
							resolvedRow.kind === 'company'
								? buildSetupImportPendingContactCompanyKey(resolvedRow)
								: null;
						const targetId =
							existingContact?.id ??
							(pendingCompanyKey ? pendingCompanyIds.get(pendingCompanyKey) : null) ??
							crypto.randomUUID();
						if (pendingCompanyKey) {
							pendingCompanyIds.set(pendingCompanyKey, targetId);
						}

						if (existingContact && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						const companyPendingId =
							resolvedRow.kind === 'company'
								? `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}${buildSetupImportPendingContactCompanyKey(resolvedRow)}`
								: '';
						const personMappedFields =
							resolvedRow.kind === 'person' && mappedFields.includes('person_name')
								? [
										...new Set([
											...mappedFields.filter((field) => field !== 'person_name'),
											'display_name',
											'name',
											'person_first_name',
											'person_last_name'
										])
									]
								: mappedFields;
						const operationMappedFields = companiesWithExpandedPeople.has(companyPendingId)
							? mappedFields.filter(
									(field) => !['person_name', 'email', 'phone', 'role_title'].includes(field)
								)
							: resolvedRow.kind === 'person' &&
								  rawRow.linked_company_id.startsWith(SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX)
								? [
										...new Set([
											...personMappedFields,
											'linked_company_id',
											'is_primary_company_contact'
										])
									]
								: personMappedFields;
						payload.contacts.push({
							id: targetId,
							action: existingContact ? 'update' : 'create',
							mappedFields: operationMappedFields,
							data: resolvedRow
						});
						const nextContact = buildContactCandidate(targetId, resolvedRow);
						const existingIndex = contactUniverse.findIndex((contact) => contact.id === targetId);
						if (existingIndex >= 0) {
							contactUniverse[existingIndex] = nextContact;
							updated += 1;
						} else {
							contactUniverse.push(nextContact);
							created += 1;
						}
					}
					break;
				}
				case 'materials': {
					for (const rawRow of preview.validRows as SetupImportCatalogueRow<MaterialCatalogItemFormValues>[]) {
						const { company_names: companyNames = [], ...row } = rawRow;
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? materialUniverse.find(
										(item) => normaliseLookupValue(item.code) === normalizedCode
									)
								: null) ??
							materialUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						const companies = companyNames.map(
							(companyName) => findSetupImportCompanyMatches(companyName, contactUniverse)[0]
						);
						const targetId = existing?.id ?? crypto.randomUUID();
						for (const company of companies)
							payload.companyCatalogueLinks.push({
								scope: 'materials',
								recordId: targetId,
								companyId: company.id
							});

						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						payload.materials.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = { id: targetId, code: row.code ?? '', name: row.name };
						const existingIndex = materialUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							materialUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							materialUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'labour_rates': {
					for (const rawRow of preview.validRows as SetupImportCatalogueRow<LabourRateCardFormValues>[]) {
						const { company_names: companyNames = [], ...row } = rawRow;
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? labourUniverse.find((item) => normaliseLookupValue(item.code) === normalizedCode)
								: null) ??
							labourUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						const companies = companyNames.map(
							(companyName) => findSetupImportCompanyMatches(companyName, contactUniverse)[0]
						);
						const targetId = existing?.id ?? crypto.randomUUID();
						for (const company of companies)
							payload.companyCatalogueLinks.push({
								scope: 'labour_rates',
								recordId: targetId,
								companyId: company.id
							});
						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						payload.labourRates.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = {
							id: targetId,
							code: row.code ?? '',
							name: row.name,
							category: row.category ?? '',
							work_center: row.work_center ?? ''
						};
						const existingIndex = labourUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							labourUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							labourUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'equipment_rates': {
					for (const rawRow of preview.validRows as SetupImportCatalogueRow<EquipmentRateCardFormValues>[]) {
						const { company_names: companyNames = [], ...row } = rawRow;
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? equipmentUniverse.find(
										(item) => normaliseLookupValue(item.code) === normalizedCode
									)
								: null) ??
							equipmentUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						const companies = companyNames.map(
							(companyName) => findSetupImportCompanyMatches(companyName, contactUniverse)[0]
						);
						const targetId = existing?.id ?? crypto.randomUUID();
						for (const company of companies)
							payload.companyCatalogueLinks.push({
								scope: 'equipment_rates',
								recordId: targetId,
								companyId: company.id
							});
						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						payload.equipmentRates.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = {
							id: targetId,
							code: row.code ?? '',
							name: row.name,
							category: row.category ?? '',
							work_center: row.work_center ?? ''
						};
						const existingIndex = equipmentUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							equipmentUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							equipmentUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'subcontract_rates': {
					for (const rawRow of preview.validRows as SetupImportCatalogueRow<SubcontractRateCardFormValues>[]) {
						const { company_names: companyNames = [], ...row } = rawRow;
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? subcontractUniverse.find(
										(item) => normaliseLookupValue(item.code) === normalizedCode
									)
								: null) ??
							subcontractUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						const companies = companyNames.map(
							(companyName) => findSetupImportCompanyMatches(companyName, contactUniverse)[0]
						);
						const targetId = existing?.id ?? crypto.randomUUID();
						for (const company of companies)
							payload.companyCatalogueLinks.push({
								scope: 'subcontract_rates',
								recordId: targetId,
								companyId: company.id
							});
						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						payload.subcontractRates.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = {
							id: targetId,
							code: row.code ?? '',
							name: row.name
						};
						const existingIndex = subcontractUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							subcontractUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							subcontractUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'cost_presets': {
					for (const row of preview.validRows as SetupImportCostPresetRow[]) {
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? presetUniverse.find((item) => normaliseLookupValue(item.code) === normalizedCode)
								: null) ??
							presetUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						const targetId = existing?.id ?? crypto.randomUUID();
						payload.costPresets.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = { id: targetId, code: row.code ?? '', name: row.name };
						const existingIndex = presetUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							presetUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							presetUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'estimate_templates': {
					for (const row of preview.validRows as SetupImportEstimateTemplateRow[]) {
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? templateUniverse.find(
										(item) => normaliseLookupValue(item.code) === normalizedCode
									)
								: null) ??
							templateUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						const targetId = existing?.id ?? crypto.randomUUID();
						payload.estimateTemplates.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = { id: targetId, code: row.code ?? '', name: row.name };
						const existingIndex = templateUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							templateUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							templateUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'project_structure_templates': {
					for (const row of preview.validRows as SetupImportProjectStructureTemplateRow[]) {
						const normalizedCode = normaliseLookupValue(row.code);
						const existing =
							(normalizedCode
								? projectStructureTemplateUniverse.find(
										(item) => normaliseLookupValue(item.code) === normalizedCode
									)
								: null) ??
							projectStructureTemplateUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ??
							null;

						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						const targetId = existing?.id ?? crypto.randomUUID();
						payload.projectStructureTemplates.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							data: row
						});
						const nextItem = { id: targetId, code: row.code ?? '', name: row.name };
						const existingIndex = projectStructureTemplateUniverse.findIndex(
							(item) => item.id === targetId
						);
						if (existingIndex >= 0) {
							projectStructureTemplateUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							projectStructureTemplateUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'classification_systems': {
					for (const [index, row] of (
						preview.validRows as ClassificationSystemFormValues[]
					).entries()) {
						const clientKey = buildPendingSystemValue(sheet.sheetId, index);
						const existing =
							classificationUniverse.find(
								(item) => normaliseLookupValue(item.name) === normaliseLookupValue(row.name)
							) ?? null;
						const targetId = existing?.id ?? crypto.randomUUID();
						resolvedPendingSystems.set(clientKey, targetId);

						if (existing && importMode === 'keep_existing') {
							skipped += 1;
							continue;
						}

						payload.classificationSystems.push({
							id: targetId,
							action: existing ? 'update' : 'create',
							mappedFields,
							clientKey,
							data: row
						});
						const nextItem = { id: targetId, name: row.name };
						const existingIndex = classificationUniverse.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							classificationUniverse[existingIndex] = nextItem;
							updated += 1;
						} else {
							classificationUniverse.push(nextItem);
							created += 1;
						}
					}
					break;
				}
				case 'cost_codes': {
					const selectedValue = this.costCodeSystemSelections.get(sheet.sheetId) ?? null;
					if (!selectedValue) {
						throw new Error('Choose a classification system before importing cost codes.');
					}
					const pending = parsePendingSystemValue(selectedValue);
					const classificationSystemId = pending
						? resolvedPendingSystems.get(buildPendingSystemValue(pending.sheetId, pending.rowIndex))
						: selectedValue.startsWith(COST_CODE_SYSTEM_PREFIX)
							? selectedValue.slice(COST_CODE_SYSTEM_PREFIX.length)
							: selectedValue;

					if (!classificationSystemId) {
						throw new Error(
							'The selected classification system is not ready yet. Import the system first.'
						);
					}

					if (!costCodeUniverseBySystem.has(classificationSystemId)) {
						costCodeUniverseBySystem.set(
							classificationSystemId,
							await dbService.getCostCodes(classificationSystemId, true)
						);
					}
					const costCodes = costCodeUniverseBySystem.get(classificationSystemId) ?? [];
					const existingByCode = new SvelteMap(
						costCodes.map((item) => [normaliseLookupValue(item.code), item])
					);
					const hierarchy = analyseCostCodeHierarchy(preview.validRows as CostCodeFormValues[], {
						existingCodes: costCodes
					});
					if (hierarchy.issues.length > 0) {
						throw new Error(hierarchy.issues[0].message);
					}
					const insertedIdsByCode = new SvelteMap<string, string>();
					for (const { row } of hierarchy.orderedRows) {
						const normalizedCode = normaliseLookupValue(row.code);
						const normalizedParentRef = normaliseLookupValue(row.parent_id?.trim() || null);
						const parentId = row.parent_id
							? (insertedIdsByCode.get(normalizedParentRef) ??
								existingByCode.get(normalizedParentRef)?.id ??
								null)
							: null;
						const existingCode = existingByCode.get(normalizedCode);

						if (existingCode && importMode === 'keep_existing') {
							insertedIdsByCode.set(normalizedCode, existingCode.id);
							skipped += 1;
							continue;
						}

						const targetId = existingCode?.id ?? crypto.randomUUID();
						payload.costCodes.push({
							id: targetId,
							action: existingCode ? 'update' : 'create',
							mappedFields,
							classificationSystemId,
							data: {
								...row,
								parent_id: parentId
							}
						});
						const nextItem: CostCode = {
							id: targetId,
							classification_system_id: classificationSystemId,
							parent_id: parentId,
							code: row.code,
							name: row.name,
							description: row.description ?? '',
							is_active: row.is_active ?? true,
							sort_order: row.sort_order,
							created_at: existingCode?.created_at ?? ''
						};
						existingByCode.set(normalizedCode, nextItem);
						const existingIndex = costCodes.findIndex((item) => item.id === targetId);
						if (existingIndex >= 0) {
							costCodes[existingIndex] = nextItem;
							updated += 1;
						} else {
							costCodes.push(nextItem);
							created += 1;
						}
						insertedIdsByCode.set(normalizedCode, targetId);
					}

					costCodeUniverseBySystem.set(classificationSystemId, costCodes);
					break;
				}
			}

			const signature = this.buildSheetImportSignature(sheet.sheetId);
			if (signature) {
				signatures.set(sheet.sheetId, signature);
			}
			sheetResults.push({
				sheetId: sheet.sheetId,
				sheetName: sheet.sheetName,
				targetTable: sheet.targetTable,
				created,
				updated,
				skipped,
				skippedRows: preview.skippedRowCount ?? 0,
				validRowCount: preview.validRows.length,
				importedAt: new Date().toISOString()
			});
		}

		return {
			payload,
			sheetResults,
			signatures,
			resolvedPendingSystems
		};
	}

	private async refreshImportedStateAuthorities(): Promise<void> {
		const results = await Promise.allSettled([
			contactsState.refresh(),
			materialsState.refresh(),
			labourRatesState.refresh(),
			equipmentRatesState.refresh(),
			subcontractRatesState.refresh(),
			costComponentPresetsState.refresh(),
			estimateTemplatesState.refresh(),
			projectStructureTemplatesState.refresh(),
			classificationSystemsState.refresh(),
			classificationSystemsState.refreshCostCodes()
		]);
		const failure = results.find((result) => result.status === 'rejected');
		if (failure?.status === 'rejected') throw failure.reason;
	}

	private getBlockedPreflightError(preflight: SetupImportPreflight): Error {
		const dependencyMessage = preflight.dependencyErrors[0]?.message;
		if (dependencyMessage) {
			return new Error(dependencyMessage);
		}

		for (const sheetId of preflight.blockedSheetIds) {
			const preview = this.sheetPreviews.get(sheetId);
			const rowMessage = preview?.errors[0]?.messages[0];
			if (rowMessage) {
				return new Error(rowMessage);
			}
		}

		return new Error('Resolve or ignore every remaining sheet before importing.');
	}

	async applyImport(): Promise<SetupImportRunSummary | null> {
		if (this.isLoading || this.isImporting) return null;
		const session = this.sessionRevision;
		if (this.hasPendingImportRefresh) {
			this.isImporting = true;
			try {
				await this.refreshImportedStateAuthorities();
				if (session !== this.sessionRevision) return null;
				this.hasPendingImportRefresh = false;
				return this.lastImportRunSummary;
			} catch (error) {
				if (session === this.sessionRevision) {
					await errorState.catchError(error, 'Refresh imported setup data', undefined, {
						description:
							'Your data was imported. Refresh it to continue without importing it again.'
					});
				}
				return null;
			} finally {
				this.isImporting = false;
			}
		}
		const preflight = this.buildImportPreflight();
		if (!preflight.canApply) {
			log.warn('Blocked setup import apply during preflight', {
				readySheetIds: preflight.readySheetIds,
				blockedSheetIds: preflight.blockedSheetIds,
				dependencyErrors: preflight.dependencyErrors,
				remediationRequired: preflight.remediationRequired
			});
			await errorState.catchError(this.getBlockedPreflightError(preflight), 'Apply setup import');
			return null;
		}

		this.isImporting = true;
		let committed = false;
		try {
			const build = await this.buildApplySession();
			if (session !== this.sessionRevision) return null;
			const ignoredSheetCount = this.sheets.filter((sheet) =>
				this.isSheetExplicitlyIgnored(sheet.sheetId)
			).length;
			const totals = build.sheetResults.reduce(
				(summary, result) => ({
					created: summary.created + result.created,
					updated: summary.updated + result.updated,
					skipped: summary.skipped + result.skipped + result.skippedRows
				}),
				{ created: 0, updated: 0, skipped: 0 }
			);
			await dbService.applySetupImportSession({
				...build.payload,
				audit: {
					id: crypto.randomUUID(),
					sourceFileName: this.sourceFileName,
					sourceContentHash: this.sourceContentHash,
					importedSheetIds: build.sheetResults.map((result) => result.sheetId),
					duplicateModesJson: JSON.stringify(
						Object.fromEntries(
							build.sheetResults.map((result) => [
								result.sheetId,
								this.sheetImportModes.get(result.sheetId) ?? 'keep_existing'
							])
						)
					),
					createdCount: totals.created,
					updatedCount: totals.updated,
					skippedCount: totals.skipped,
					failureSummary: null
				}
			});
			committed = true;
			if (session !== this.sessionRevision) {
				await this.refreshImportedStateAuthorities();
				return null;
			}

			if (build.sheetResults.length > 0) {
				this.resolvedPendingSystems.clear();
				for (const [key, value] of build.resolvedPendingSystems.entries()) {
					this.resolvedPendingSystems.set(key, value);
				}
				for (const result of build.sheetResults) {
					this.sheetImportResults.set(result.sheetId, result);
					const signature = build.signatures.get(result.sheetId);
					if (signature) {
						this.importedSheetSignatures.set(result.sheetId, signature);
					}
				}
				this.lastImportRunSummary = buildImportRunSummary(build.sheetResults, ignoredSheetCount);
				this.hasPendingImportRefresh = true;
				await this.refreshImportedStateAuthorities();
				if (session !== this.sessionRevision) return null;
				this.hasPendingImportRefresh = false;
				log.info('Completed setup import apply', {
					readySheetIds: preflight.readySheetIds,
					ignoredSheetCount,
					sheetResults: build.sheetResults.map((result) => ({
						sheetId: result.sheetId,
						targetTable: result.targetTable,
						validRowCount: result.validRowCount,
						created: result.created,
						updated: result.updated,
						skipped: result.skipped
					}))
				});
				return this.lastImportRunSummary;
			}
			return null;
		} catch (error) {
			if (committed) {
				log.error('Setup data imported, but refreshing data failed', { error });
				await errorState.catchError(error, 'Refresh imported setup data', undefined, {
					description:
						session === this.sessionRevision
							? 'Your data was imported. Refresh it to continue without importing it again.'
							: 'Your data was imported. Reopen the affected page or restart Kwantflow to refresh it.'
				});
				return null;
			}
			if (session !== this.sessionRevision) return null;
			this.lastImportRunSummary = null;
			log.error('Setup import apply failed', {
				error,
				preflight,
				partialSheetResults: []
			});
			await errorState.catchError(error, 'Apply setup import');
			return null;
		} finally {
			this.isImporting = false;
		}
	}
}

export const setupImportState = new SetupImportState();
