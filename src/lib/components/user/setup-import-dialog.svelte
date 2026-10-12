<!-- Sheet-first workspace setup import wizard for business setup tables. -->
<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
	import UploadIcon from '@lucide/svelte/icons/upload';

	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { FieldLabel, Meta, Panel, Text } from '$lib/components/primitives/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { setupImportTargetTableOptions } from '$lib/constants/setup-import-registry.js';
	import type {
		SetupImportSchemaFieldDigest,
		SetupImportTargetTable
	} from '$lib/constants/setup-import-registry.js';
	import {
		CLASSIFICATION_SYSTEM_TYPE_OPTIONS,
		getUnitOptions,
		SUBCONTRACT_RATE_UNIT_OPTIONS,
		WORKSPACE_COUNTRY_OPTIONS
	} from '$lib/constants/index.js';
	import { setupImportState } from '$lib/state/setup-import.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import type {
		SetupImportDuplicateMode,
		SetupImportSheetPreview,
		SetupImportSheetMapping,
		SetupImportMappingStatus,
		SetupImportSheetAnalysis,
		SetupImportWorkbook
	} from '$lib/services/setup-import.js';
	import { getSetupImportFieldLabel } from '$lib/services/setup-import.js';
	import { allowExternalFileRead } from '$lib/services/external-file-access.js';
	import { isTauri } from '$lib/utils/env.js';
	import {
		SETUP_IMPORT_ALIAS_FIELD_DESCRIPTION,
		SETUP_IMPORT_ALIAS_UPLOAD_HELP
	} from '$lib/constants/alias-guidance.js';

	let {
		open = $bindable(false),
		onImported
	}: {
		open?: boolean;
		onImported?: (() => void | Promise<void>) | undefined;
	} = $props();

	const IGNORE_FIELD_VALUE = '__ignore__';
	const UNRESOLVED_FIELD_VALUE = '__unresolved__';
	const IGNORE_TABLE_VALUE = '__ignore_table__';
	const UNASSIGNED_TABLE_VALUE = '';
	import { getSetupImportExtensions } from '$lib/constants/file-support.js';

	const SUPPORTED_SPREADSHEET_EXTENSIONS = getSetupImportExtensions();
	const TARGET_TABLE_OPTIONS: Array<{ value: SetupImportTargetTable; label: string }> = [
		...setupImportTargetTableOptions
	];
	const IMPORT_MODE_OPTIONS: Array<{ value: SetupImportDuplicateMode; label: string }> = [
		{ value: 'keep_existing', label: 'Keep existing' },
		{ value: 'update_matched', label: 'Update matched' }
	];
	let isDraggingOver = $state(false);
	let isFinishingSetup = $state(false);
	let dialogSession = 0;
	let pendingCompletionWorkbook = $state.raw<SetupImportWorkbook | null>(null);
	let hasPendingCompletion = $derived(
		pendingCompletionWorkbook !== null && pendingCompletionWorkbook === setupImportState.workbook
	);

	function closeDialog(): void {
		open = false;
		pendingCompletionWorkbook = null;
		setupImportState.clear();
	}

	function getSheetPreview(sheetId: string): SetupImportSheetPreview | null {
		return setupImportState.sheetPreviews.get(sheetId) ?? null;
	}

	function sheetHasRowIssues(sheetId: string): boolean {
		return (getSheetPreview(sheetId)?.errors.length ?? 0) > 0;
	}

	function isRowValidationDeferred(sheetId: string): boolean {
		return getSheetPreview(sheetId)?.rowValidationDeferred ?? false;
	}

	function isSheetIgnored(sheetId: string): boolean {
		return setupImportState.isSheetExplicitlyIgnored(sheetId);
	}

	function getSheetStatusLabel(sheet: SetupImportSheetAnalysis): string {
		const sessionState = setupImportState.getSheetSessionState(sheet.sheetId);
		if (sessionState === 'imported') {
			return 'Imported';
		}
		if (!sheet.targetTable) {
			return isSheetIgnored(sheet.sheetId) ? 'Ignored' : 'Not assigned';
		}
		if (sheetHasRowIssues(sheet.sheetId)) {
			return 'Rows need fixes';
		}
		switch (sheet.readiness) {
			case 'ready':
				return 'Ready';
			case 'needs_review':
				return 'Needs review';
			case 'blocked':
				return 'Blocked';
			default:
				return 'Ignored';
		}
	}

	function getSheetStatusDotClasses(sheet: SetupImportSheetAnalysis): string {
		const sessionState = setupImportState.getSheetSessionState(sheet.sheetId);
		if (sessionState === 'imported') {
			return 'status-dot-brand';
		}
		if (!sheet.targetTable) {
			return isSheetIgnored(sheet.sheetId) ? 'status-dot-muted' : 'status-dot-warning';
		}
		if (sheetHasRowIssues(sheet.sheetId)) {
			return 'status-dot-destructive';
		}
		switch (sheet.readiness) {
			case 'ready':
				return 'status-dot-success';
			case 'needs_review':
				return 'status-dot-warning';
			case 'blocked':
				return 'status-dot-destructive';
			default:
				return 'status-dot-muted';
		}
	}

	function getSheetCardToneClasses(sheet: SetupImportSheetAnalysis): string {
		const sessionState = setupImportState.getSheetSessionState(sheet.sheetId);
		if (sessionState === 'imported') {
			return 'ui-choice-card-imported';
		}
		if (!sheet.targetTable) {
			return isSheetIgnored(sheet.sheetId) ? 'ui-choice-card-muted' : 'ui-choice-card-neutral';
		}
		return 'ui-choice-card-neutral';
	}

	function getSheetActiveClasses(sheet: SetupImportSheetAnalysis): string {
		return setupImportState.activeSheetId === sheet.sheetId ? 'ui-choice-card-selected' : '';
	}

	function getSheetStatusTextClasses(sheet: SetupImportSheetAnalysis): string {
		const sessionState = setupImportState.getSheetSessionState(sheet.sheetId);
		if (sessionState === 'imported') return 'text-primary';
		if (!sheet.targetTable) {
			return isSheetIgnored(sheet.sheetId) ? 'muted' : 'text-warning';
		}
		if (sheetHasRowIssues(sheet.sheetId)) return 'text-destructive';
		switch (sheet.readiness) {
			case 'ready':
				return 'text-success';
			case 'needs_review':
				return 'text-warning';
			case 'blocked':
				return 'text-destructive';
			default:
				return 'muted';
		}
	}

	function getMappingStatusVariant(status: SetupImportMappingStatus): BadgeVariant {
		switch (status) {
			case 'green':
				return 'default';
			case 'yellow':
				return 'outline';
			case 'ignored':
				return 'secondary';
			case 'red':
				return 'outline';
		}
	}

	function getMappingStatusClasses(status: SetupImportMappingStatus): string {
		switch (status) {
			case 'green':
				return 'border-transparent bg-success text-primary-foreground';
			case 'yellow':
				return 'status-badge-warning';
			case 'ignored':
				return 'muted';
			case 'red':
				return 'status-badge-destructive';
		}
	}

	function getMappingStatusLabel(status: SetupImportMappingStatus): string {
		switch (status) {
			case 'green':
				return 'Matched';
			case 'yellow':
				return 'Check';
			case 'ignored':
				return 'Ignored';
			case 'red':
				return 'Needs mapping';
		}
	}

	function getMappingStatusTooltip(mapping: SetupImportSheetMapping): string {
		if (mapping.status === 'yellow' && mapping.reason) {
			if (/multiple or inconsistent email/i.test(mapping.reason)) {
				return 'Some values look like mixed email data. Confirm this match or choose another field.';
			}
			if (/multiple or inconsistent phone/i.test(mapping.reason)) {
				return 'Some values look like mixed phone data. Confirm this match or choose another field.';
			}
			return 'This column has a likely match. Confirm it or choose a different field before importing this sheet.';
		}

		switch (mapping.status) {
			case 'green':
				return 'This column is matched to an import field. Individual rows can still need fixes if their values are blank or invalid.';
			case 'yellow':
				return 'This column has a likely match. Confirm it or choose a different field before importing this sheet.';
			case 'ignored':
				return 'This column is intentionally ignored and will not be imported.';
			case 'red':
				return 'This column still needs a field selection before the sheet can import.';
		}
	}

	function getSheetQueueRank(sheet: SetupImportSheetAnalysis): number {
		const sessionState = setupImportState.getSheetSessionState(sheet.sheetId);
		if (sessionState === 'imported') return 4;
		if (!sheet.targetTable) return isSheetIgnored(sheet.sheetId) ? 5 : 0;
		if (sheet.readiness === 'blocked') return 1;
		if (sheetHasRowIssues(sheet.sheetId)) return 2;
		if (sheet.readiness === 'needs_review') return 2;
		if (sheet.readiness === 'ready') return 3;
		return 6;
	}

	function getOrderedSheets(): SetupImportSheetAnalysis[] {
		return [...setupImportState.sheets].sort((left, right) => {
			const rankDifference = getSheetQueueRank(left) - getSheetQueueRank(right);
			if (rankDifference !== 0) return rankDifference;
			return left.sheetName.localeCompare(right.sheetName);
		});
	}

	function getSelectedTableLabel(sheet: SetupImportSheetAnalysis): string {
		if (!sheet.targetTable) {
			return isSheetIgnored(sheet.sheetId) ? 'Ignored sheet' : 'Choose import table';
		}
		return (
			TARGET_TABLE_OPTIONS.find((option) => option.value === sheet.targetTable)?.label ??
			'Choose import table'
		);
	}

	function getImportModeLabel(mode: SetupImportDuplicateMode): string {
		return IMPORT_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Keep existing';
	}

	function getImportModeTooltip(mode: SetupImportDuplicateMode): string {
		switch (mode) {
			case 'update_matched':
				return 'Rows that match existing workspace records will update them. New rows will still be added.';
			case 'keep_existing':
			default:
				return 'Rows that match existing workspace records will be skipped, and only new rows will be imported.';
		}
	}

	function getReviewCounts(sheet: SetupImportSheetAnalysis): {
		green: number;
		yellow: number;
		red: number;
		ignored: number;
	} {
		return {
			green: sheet.mappings.filter((mapping) => mapping.status === 'green').length,
			yellow: sheet.mappings.filter((mapping) => mapping.status === 'yellow').length,
			red: sheet.mappings.filter((mapping) => mapping.status === 'red').length,
			ignored: sheet.mappings.filter((mapping) => mapping.status === 'ignored').length
		};
	}

	function canShowMappingGrid(sheet: SetupImportSheetAnalysis): boolean {
		const workbookSheet = setupImportState.workbook?.sheets.find(
			(entry) => entry.sheetId === sheet.sheetId
		);
		return !!sheet.targetTable && (workbookSheet?.headerIssues.length ?? 0) === 0;
	}

	function getSheetGuidance(sheet: SetupImportSheetAnalysis): string {
		const dependencyIssue = setupImportState
			.getImportPreflight()
			.dependencyErrors.find((issue) => issue.sheetId === sheet.sheetId);
		if (dependencyIssue) {
			return dependencyIssue.message;
		}
		const sessionState = setupImportState.getSheetSessionState(sheet.sheetId);
		const workbookSheet = setupImportState.workbook?.sheets.find(
			(entry) => entry.sheetId === sheet.sheetId
		);
		if ((workbookSheet?.headerIssues.length ?? 0) > 0) {
			return 'Fix the spreadsheet headers, then review the mapping.';
		}
		if (!sheet.targetTable) {
			if (isSheetIgnored(sheet.sheetId)) {
				return 'This sheet is skipped unless you assign it to an import table.';
			}
			return 'Choose an import table to start mapping this sheet.';
		}
		if (sessionState === 'imported') {
			return 'This sheet was already imported in this session.';
		}
		if (
			sheet.targetTable === 'cost_codes' &&
			!setupImportState.costCodeSystemSelections.get(sheet.sheetId)
		) {
			return 'Choose a classification system before reviewing or importing cost codes.';
		}
		if (sheet.missingRequiredFields.length > 0) {
			return 'Map the required fields before row validation can begin.';
		}
		if (sheet.readiness === 'needs_review') {
			if (sessionState === 'dirty_after_import') {
				return 'This sheet changed after import. Review it, then re-import.';
			}
			return 'Confirm the suggested matches before this sheet can import.';
		}
		if (isRowValidationDeferred(sheet.sheetId)) {
			return 'Finish mapping this sheet to start row validation.';
		}
		if (sheetHasRowIssues(sheet.sheetId)) {
			return 'Fix the remaining row values to unblock this sheet.';
		}
		if (sessionState === 'dirty_after_import') {
			return 'This sheet changed after import. Re-import to apply the latest mappings.';
		}
		return 'Sheet ready to import.';
	}

	function getSheetSummaryMeta(sheet: SetupImportSheetAnalysis): string {
		if (!sheet.targetTable) {
			if (isSheetIgnored(sheet.sheetId)) {
				return 'Ignored for this import';
			}
			return `${getAvailableColumnCount(sheet)} column${getAvailableColumnCount(sheet) === 1 ? '' : 's'} detected`;
		}
		if (
			sheet.targetTable === 'cost_codes' &&
			!setupImportState.costCodeSystemSelections.get(sheet.sheetId)
		) {
			return 'Choose system';
		}
		if (sheet.missingRequiredFields.length > 0) {
			return `${sheet.missingRequiredFields.length} required field${sheet.missingRequiredFields.length === 1 ? '' : 's'} left`;
		}
		if (sheet.unmatchedColumns.length > 0) {
			return `${sheet.unmatchedColumns.length} column${sheet.unmatchedColumns.length === 1 ? '' : 's'} need mapping`;
		}
		const reviewCount = getReviewCounts(sheet).yellow;
		if (reviewCount > 0) {
			return `${reviewCount} match${reviewCount === 1 ? '' : 'es'} to confirm`;
		}
		const rowIssueCount = getSheetPreview(sheet.sheetId)?.errors.length ?? 0;
		if (rowIssueCount > 0) {
			return `${rowIssueCount} row${rowIssueCount === 1 ? '' : 's'} need fixes`;
		}
		const counts = getReviewCounts(sheet);
		return `${counts.green} matched${counts.ignored > 0 ? ` · ${counts.ignored} ignored` : ''}`;
	}

	function getAvailableColumnCount(sheet: SetupImportSheetAnalysis): number {
		return (
			setupImportState.workbook?.sheets.find((entry) => entry.sheetId === sheet.sheetId)?.headers
				.length ?? 0
		);
	}

	function getTargetFieldLabel(sheetId: string, fieldId: string): string {
		const tableId = setupImportState.getSheet(sheetId)?.targetTable ?? null;
		const table = tableId
			? setupImportState.digest.tables.find((entry) => entry.id === tableId)
			: null;
		return table?.fields.find((field) => field.id === fieldId)?.label ?? fieldId;
	}

	function getTargetFieldDefinition(
		sheetId: string,
		fieldId: string
	): SetupImportSchemaFieldDigest | null {
		const tableId = setupImportState.getSheet(sheetId)?.targetTable ?? null;
		const table = tableId
			? setupImportState.digest.tables.find((entry) => entry.id === tableId)
			: null;
		return table?.fields.find((field) => field.id === fieldId) ?? null;
	}

	function getTargetFieldSelectOptions(sheetId: string) {
		return setupImportState.getTargetFieldOptions(sheetId).map((fieldId) => {
			const field = getTargetFieldDefinition(sheetId, fieldId);
			return {
				value: fieldId,
				label: field?.label ?? fieldId,
				description: field ? getTargetFieldDescription(field) : ''
			};
		});
	}

	function getTargetFieldDescription(field: SetupImportSchemaFieldDigest): string {
		if (field.id === 'aliases') return SETUP_IMPORT_ALIAS_FIELD_DESCRIPTION;
		return field.aliases.length > 0
			? `Also matches: ${field.aliases.slice(0, 4).join(', ')}`
			: 'No additional aliases configured for this field.';
	}

	function getSheetTargetValue(sheet: SetupImportSheetAnalysis): string {
		if (!sheet.targetTable) {
			return isSheetIgnored(sheet.sheetId) ? IGNORE_TABLE_VALUE : UNASSIGNED_TABLE_VALUE;
		}
		return sheet.targetTable;
	}

	function getMappingTargetValue(mapping: SetupImportSheetMapping): string {
		if (mapping.targetField) return mapping.targetField;
		return mapping.status === 'ignored' ? IGNORE_FIELD_VALUE : UNRESOLVED_FIELD_VALUE;
	}

	function getMappingTriggerLabel(sheetId: string, mapping: SetupImportSheetMapping): string {
		if (mapping.targetField) {
			return getTargetFieldLabel(sheetId, mapping.targetField);
		}
		return mapping.status === 'ignored' ? 'Ignore column' : 'Choose field';
	}

	function getSampleValue(sheetId: string, sourceColumn: string): string {
		const workbookSheet = setupImportState.workbook?.sheets.find(
			(sheet) => sheet.sheetId === sheetId
		);
		if (!workbookSheet) return '';
		const combined = workbookSheet.rows
			.slice(0, 3)
			.map((row) => row[sourceColumn] ?? '')
			.filter(Boolean)
			.join(' · ');
		return combined.length > 72 ? `${combined.slice(0, 69).trimEnd()}...` : combined;
	}

	function getWorkbookReviewCount(sheets: SetupImportSheetAnalysis[]): number {
		return sheets.filter((sheet) => {
			return !setupImportState.isSheetResolved(sheet.sheetId);
		}).length;
	}

	function getWorkbookSummaryLine(sheets: SetupImportSheetAnalysis[]): string {
		const parts: string[] = [];
		if (setupImportState.readySheetCount > 0) {
			parts.push(`${setupImportState.readySheetCount} ready`);
		}
		if (setupImportState.importedSheetCount > 0) {
			parts.push(`${setupImportState.importedSheetCount} imported`);
		}
		const reviewCount = getWorkbookReviewCount(sheets);
		if (reviewCount > 0) {
			parts.push(`${reviewCount} to review`);
		}
		return parts.join(' · ') || 'All ready sheets imported';
	}

	function getPreviewSummary(
		sheet: SetupImportSheetAnalysis,
		preview: SetupImportSheetPreview | null | undefined
	): string {
		const validRowCount = preview?.validRows.length ?? 0;
		const rowIssueCount = preview?.errors.length ?? 0;
		const skippedRowCount = preview?.skippedRowCount ?? 0;
		if (validRowCount === 0 && rowIssueCount === 0) {
			if (skippedRowCount > 0) {
				return `${skippedRowCount} source row${skippedRowCount === 1 ? '' : 's'} skipped. No remaining rows are ready on this sheet yet.`;
			}
			return 'No rows are ready on this sheet yet.';
		}
		const workbookSheet = setupImportState.workbook?.sheets.find(
			(entry) => entry.sheetId === sheet.sheetId
		);
		const sourceRowCount = workbookSheet?.rowCount ?? validRowCount;
		if (sheetHasRowIssues(sheet.sheetId)) {
			if (validRowCount === 0) {
				return `${rowIssueCount} source row${rowIssueCount === 1 ? '' : 's'} still need fixing before this sheet can import.${skippedRowCount > 0 ? ` ${skippedRowCount} row${skippedRowCount === 1 ? ' is' : 's are'} skipped.` : ''}`;
			}
			return `${validRowCount} row${validRowCount === 1 ? '' : 's'} already fit Kwantflow. ${rowIssueCount} source row${rowIssueCount === 1 ? '' : 's'} still ${rowIssueCount === 1 ? 'blocks' : 'block'} this sheet until ${rowIssueCount === 1 ? 'it is' : 'they are'} fixed.${skippedRowCount > 0 ? ` ${skippedRowCount} row${skippedRowCount === 1 ? ' is' : 's are'} skipped.` : ''}`;
		}
		if (sheet.targetTable === 'contacts' && sourceRowCount > 0 && validRowCount > sourceRowCount) {
			return `${sourceRowCount} source row${sourceRowCount === 1 ? '' : 's'} expand to ${validRowCount} company and contact records.`;
		}
		return `${validRowCount} valid row${validRowCount === 1 ? '' : 's'} ready${skippedRowCount > 0 ? ` · ${skippedRowCount} skipped` : ''}`;
	}

	function getFieldDigest(sheet: SetupImportSheetAnalysis, fieldId: string) {
		return setupImportState.digest.tables
			.find((entry) => entry.id === sheet.targetTable)
			?.fields.find((field) => field.id === fieldId);
	}

	function getRowIssueCardSummary(
		sheet: SetupImportSheetAnalysis,
		preview: SetupImportSheetPreview | null | undefined
	): string {
		const issueCount = preview?.errors.length ?? 0;
		const validRowCount = preview?.validRows.length ?? 0;
		const skippedRowCount = preview?.skippedRowCount ?? 0;
		if (issueCount === 0) return 'This sheet has no blocking row issues.';
		if (validRowCount > 0) {
			return `${validRowCount} row${validRowCount === 1 ? '' : 's'} already fit Kwantflow. Review the blocked source row${issueCount === 1 ? '' : 's'} below. Some can be corrected here, and some need to be fixed in the spreadsheet before you replace the file.${skippedRowCount > 0 ? ` ${skippedRowCount} row${skippedRowCount === 1 ? ' is' : 's are'} already skipped.` : ''}`;
		}
		return `Review the blocked rows below. Some can be corrected here, and some need to be fixed in the spreadsheet before you replace the file.${skippedRowCount > 0 ? ` ${skippedRowCount} row${skippedRowCount === 1 ? ' is' : 's are'} already skipped.` : ''}`;
	}

	function getRowFixFieldLabel(sheet: SetupImportSheetAnalysis, fieldId: string): string {
		return getFriendlyFieldLabel(sheet, fieldId);
	}

	type RowFixOption = { value: string; label: string };

	function getUnitOptionsForSheet(sheet: SetupImportSheetAnalysis): RowFixOption[] {
		switch (sheet.targetTable) {
			case 'materials':
				return getUnitOptions('material').map((option) => ({
					value: option.value,
					label: option.label
				}));
			case 'labour_rates':
				return getUnitOptions('labour-rate').map((option) => ({
					value: option.value,
					label: option.label
				}));
			case 'equipment_rates':
				return getUnitOptions('equipment-rate').map((option) => ({
					value: option.value,
					label: option.label
				}));
			case 'subcontract_rates':
				return SUBCONTRACT_RATE_UNIT_OPTIONS.map((option) => ({
					value: option.value,
					label: option.label
				}));
			default:
				return [];
		}
	}

	function getRowFixFieldOptions(
		sheet: SetupImportSheetAnalysis,
		fieldId: string
	): RowFixOption[] | null {
		switch (fieldId) {
			case 'country_code':
				return WORKSPACE_COUNTRY_OPTIONS.map((option) => ({
					value: option.code,
					label: `${option.label} (${option.code})`
				}));
			case 'type':
				return CLASSIFICATION_SYSTEM_TYPE_OPTIONS.map((option) => ({
					value: option.value,
					label: option.label
				}));
			case 'unit':
				return getUnitOptionsForSheet(sheet);
			case 'is_default':
			case 'is_active':
			case 'is_primary_company_contact':
				return [
					{ value: 'true', label: 'Yes' },
					{ value: 'false', label: 'No' }
				];
			case 'kind':
				return [
					{ value: 'company', label: 'Company' },
					{ value: 'person', label: 'Person' }
				];
			default:
				return null;
		}
	}

	function isWizardRepairableField(fieldId: string): boolean {
		return !['components_json', 'estimate_json'].includes(fieldId);
	}

	function getRowFixFieldKind(
		sheet: SetupImportSheetAnalysis,
		fieldId: string
	): 'select' | 'textarea' | 'number' | 'input' {
		if (getRowFixFieldOptions(sheet, fieldId)) return 'select';
		if (getFieldDigest(sheet, fieldId)?.type === 'number') return 'number';
		if (['components_json', 'estimate_json', 'notes', 'description', 'address'].includes(fieldId)) {
			return 'textarea';
		}
		return 'input';
	}

	function getRowFixFieldValue(
		sheetId: string,
		issue: NonNullable<SetupImportSheetPreview['errors']>[number],
		fieldId: string
	): string {
		if (setupImportState.hasRowFieldDraft(sheetId, issue.rowNumber, fieldId)) {
			return setupImportState.getRowFieldDraft(sheetId, issue.rowNumber, fieldId);
		}
		const override = setupImportState.getRowFieldOverride(sheetId, issue.rowNumber, fieldId);
		if (override) return override;
		return issue.mappedValues[fieldId] ?? '';
	}

	function getRowFixSourceValue(
		issue: NonNullable<SetupImportSheetPreview['errors']>[number],
		fieldId: string
	): string {
		return issue.mappedValues[fieldId] ?? '';
	}

	function getRowFixSourceValueLabel(
		issue: NonNullable<SetupImportSheetPreview['errors']>[number],
		fieldId: string
	): string | null {
		const value = getRowFixSourceValue(issue, fieldId).trim();
		if (!value) return null;
		return value.length > 56 ? `${value.slice(0, 53).trimEnd()}...` : value;
	}

	function getRowFixFieldMessage(
		issue: NonNullable<SetupImportSheetPreview['errors']>[number],
		fieldId: string
	): string {
		return (
			issue.fieldIssues.find((fieldIssue) => fieldIssue.fieldId === fieldId)?.message ??
			issue.messages.join(' · ')
		);
	}

	function getRowFixFieldGuidance(
		sheet: SetupImportSheetAnalysis,
		issue: NonNullable<SetupImportSheetPreview['errors']>[number],
		fieldId: string
	): string {
		switch (fieldId) {
			case 'phone':
				return 'Enter digits only, for example 0400123456 or +64 21 440 900.';
			case 'email':
				return 'Enter one valid email address, for example name@example.com.';
			case 'country_code':
				return 'Choose the correct country below.';
			case 'type':
				return 'Choose the matching classification type below.';
			case 'unit':
				return 'Choose the closest unit below.';
			case 'sort_order':
				return 'Enter a whole number, for example 10.';
			case 'default_rate':
				return 'Enter a number, for example 125.50.';
			case 'name':
				if (sheet.targetTable === 'labour_rates') return 'Enter the rate name for this row.';
				if (sheet.targetTable === 'classification_systems')
					return 'Enter the classification system name for this row.';
				if (sheet.targetTable === 'cost_presets') return 'Enter the preset name for this row.';
				return 'Enter the name for this row.';
			case 'code':
				return 'Enter the code for this row.';
			case 'components_json':
				return 'Fix this preset row in the spreadsheet, then replace the file to continue.';
			case 'estimate_json':
				return 'Fix this template row in the spreadsheet, then replace the file to continue.';
			case 'is_default':
			case 'is_active':
			case 'is_primary_company_contact':
				return 'Choose Yes or No for this row.';
			default:
				return getCondensedIssueMessage(sheet, fieldId, getRowFixFieldMessage(issue, fieldId));
		}
	}

	function getSkippedRowSummary(sheetId: string): string {
		const rowNumbers = setupImportState.getSkippedRowNumbers(sheetId);
		if (rowNumbers.length === 0) return '';
		return `Skipped source rows: ${rowNumbers.join(', ')}`;
	}

	function getRowFixFieldPlaceholder(fieldId: string): string | undefined {
		switch (fieldId) {
			case 'phone':
				return '0400123456 or +64 21 440 900';
			case 'email':
				return 'name@example.com';
			case 'sort_order':
				return '10';
			case 'default_rate':
				return '125.50';
			default:
				return undefined;
		}
	}

	function getClassificationSystemOptions(sheetId: string) {
		return setupImportState.getCostCodeSystemOptions(sheetId);
	}

	function getClassificationSystemOptionLabel(option: {
		label: string;
		kind: 'existing' | 'pending';
	}): string {
		return option.kind === 'existing'
			? `Existing · ${option.label}`
			: `New import · ${option.label}`;
	}

	function hasSingleClassificationSystemOption(sheetId: string): boolean {
		return getClassificationSystemOptions(sheetId).length === 1;
	}

	function getSelectedClassificationSystemLabel(sheetId: string): string {
		const selectedValue = setupImportState.costCodeSystemSelections.get(sheetId) ?? '';
		return (
			getClassificationSystemOptions(sheetId).find((option) => option.value === selectedValue)
				?.label ?? 'Choose system'
		);
	}

	function getActiveSheetControlColumns(
		activeSheet: SetupImportSheetAnalysis,
		showDuplicateControls: boolean
	): string {
		if (activeSheet.targetTable === 'cost_codes' || showDuplicateControls) {
			return 'lg:grid-cols-2';
		}
		return '';
	}

	function getActiveSheetHeaderLayout(
		activeSheet: SetupImportSheetAnalysis,
		showDuplicateControls: boolean
	): string {
		if (activeSheet.targetTable === 'cost_codes' || showDuplicateControls) {
			return 'grid gap-4';
		}
		return 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]';
	}

	function getRowFixFields(
		issue: NonNullable<SetupImportSheetPreview['errors']>[number]
	): string[] {
		return [...new Set(issue.fieldIssues.map((fieldIssue) => fieldIssue.fieldId))];
	}

	function getRepairableRowFixFields(
		issue: NonNullable<SetupImportSheetPreview['errors']>[number]
	): string[] {
		return getRowFixFields(issue).filter((fieldId) => isWizardRepairableField(fieldId));
	}

	function rowNeedsSpreadsheetRepair(
		issue: NonNullable<SetupImportSheetPreview['errors']>[number]
	): boolean {
		return getRowFixFields(issue).some((fieldId) => !isWizardRepairableField(fieldId));
	}

	function getRowFixRowSummary(
		sheet: SetupImportSheetAnalysis,
		issue: NonNullable<SetupImportSheetPreview['errors']>[number]
	): string {
		if (rowNeedsSpreadsheetRepair(issue)) {
			return 'This row needs spreadsheet changes before it can be imported.';
		}
		const labels = getRowFixFields(issue).map((fieldId) => getRowFixFieldLabel(sheet, fieldId));
		if (labels.length === 0) return issue.messages.join(' · ');
		return labels.length === 1
			? `${labels[0]} needs attention on this row.`
			: `${labels.join(' · ')} need attention on this row.`;
	}

	function getCondensedIssueMessage(
		sheet: SetupImportSheetAnalysis,
		fieldId: string,
		message: string
	): string {
		const label = getRowFixFieldLabel(sheet, fieldId);
		if (/blank in this row/i.test(message)) return `${label} is blank in this row`;
		if (/valid email/i.test(message)) return `${label} needs one valid email address`;
		if (/valid phone/i.test(message)) return `${label} needs a valid phone number`;
		if (/valid country/i.test(message)) return `${label} needs a valid country`;
		if (/must be one of/i.test(message) || /invalid option/i.test(message)) {
			return `${label} needs a valid option`;
		}
		if (/must be a number|received nan/i.test(message)) return `${label} must be a number`;
		if (/not valid json/i.test(message)) {
			return `${label} has spreadsheet data Kwantflow cannot repair here`;
		}
		if (/expected structure|missing required sections/i.test(message)) {
			return `${label} has spreadsheet data Kwantflow cannot repair here`;
		}
		return message;
	}

	function getRowFixIssueSummary(
		sheet: SetupImportSheetAnalysis,
		issue: NonNullable<SetupImportSheetPreview['errors']>[number]
	): string {
		const compactMessages = issue.fieldIssues.map((fieldIssue) =>
			getCondensedIssueMessage(sheet, fieldIssue.fieldId, fieldIssue.message)
		);
		return [...new Set(compactMessages)].join(' · ');
	}

	function getRepeatedValueSummary(
		sheet: SetupImportSheetAnalysis,
		fieldId: string,
		rawValue: string,
		count: number
	): string {
		return `"${rawValue}" appears in ${count} row${count === 1 ? '' : 's'} for ${getRowFixFieldLabel(sheet, fieldId)}.`;
	}

	function formatImportResultSummary(sheetId: string): string | null {
		const result = setupImportState.getSheetImportResult(sheetId);
		if (!result) return null;
		const parts: string[] = [];
		if (result.created > 0) parts.push(`${result.created} imported`);
		if (result.updated > 0) parts.push(`${result.updated} updated`);
		if (result.skipped > 0) parts.push(`${result.skipped} kept existing`);
		if (result.skippedRows > 0)
			parts.push(`${result.skippedRows} row${result.skippedRows === 1 ? '' : 's'} skipped`);
		return parts.length > 0
			? parts.join(' · ')
			: `Imported ${result.validRowCount} row${result.validRowCount === 1 ? '' : 's'}`;
	}

	function getPrimaryImportLabel(): string {
		if (isFinishingSetup) return 'Finishing setup...';
		if (hasPendingCompletion) return 'Finish setup';
		if (setupImportState.hasPendingImportRefresh) return 'Refresh imported data';
		const preflight = setupImportState.getImportPreflight();
		if (setupImportState.isImporting) return 'Importing...';
		if (
			preflight.readySheetIds.length === 0 &&
			preflight.blockedSheetIds.length === 0 &&
			preflight.dependencyErrors.length === 0
		) {
			return 'Nothing left to import';
		}
		if (!preflight.canApply) {
			if (preflight.readySheetIds.length > 0 && preflight.dependencyErrors.length > 0) {
				return 'Resolve dependency issues';
			}
			return 'Resolve remaining sheets';
		}
		if (preflight.readySheetIds.length === 0) return 'Import workbook';
		return `Import ${setupImportState.readySheetCount} Ready Sheet${setupImportState.readySheetCount === 1 ? '' : 's'}`;
	}

	function getFriendlyFieldLabel(sheet: SetupImportSheetAnalysis, fieldId: string): string {
		return sheet.targetTable ? getSetupImportFieldLabel(sheet.targetTable, fieldId) : fieldId;
	}

	function getFriendlyMissingRequiredFields(sheet: SetupImportSheetAnalysis): string[] {
		return sheet.missingRequiredFields.map((fieldId) => getFriendlyFieldLabel(sheet, fieldId));
	}

	function hasMappingIssues(sheet: SetupImportSheetAnalysis): boolean {
		return (
			sheet.missingRequiredFields.length > 0 ||
			sheet.unmatchedColumns.length > 0 ||
			sheet.mappings.some((mapping) => mapping.status === 'yellow')
		);
	}

	function hasRowIssues(preview: SetupImportSheetPreview | null | undefined): boolean {
		return (preview?.errors.length ?? 0) > 0;
	}

	function isSheetClean(
		sheet: SetupImportSheetAnalysis,
		preview: SetupImportSheetPreview | null | undefined
	): boolean {
		return (
			!hasMappingIssues(sheet) &&
			!hasRowIssues(preview) &&
			!(preview?.rowValidationDeferred ?? false) &&
			(preview?.validRows.length ?? 0) > 0
		);
	}

	function getPreviewColumns(
		sheet: SetupImportSheetAnalysis,
		preview:
			| {
					validRows: unknown[];
			  }
			| null
			| undefined
	): Array<{ fieldId: string; label: string }> {
		const firstRow = (preview?.validRows?.[0] ?? null) as Record<string, unknown> | null;
		if (!firstRow) return [];
		return Object.keys(firstRow)
			.slice(0, 4)
			.map((fieldId) => ({
				fieldId,
				label: getFriendlyFieldLabel(sheet, fieldId)
			}));
	}

	function getPreviewCellValue(row: unknown, fieldId: string): string {
		return String((row as Record<string, unknown>)[fieldId] ?? '');
	}

	function buildImportSuccessDescription(): string {
		const summary = setupImportState.lastImportRunSummary;
		if (!summary) return 'Business data imported.';

		const parts: string[] = [];
		if (summary.totalCreated > 0) parts.push(`${summary.totalCreated} imported`);
		if (summary.totalUpdated > 0) parts.push(`${summary.totalUpdated} updated`);
		if (summary.totalSkipped > 0) parts.push(`${summary.totalSkipped} kept existing`);
		if (summary.totalSkippedRows > 0) {
			parts.push(
				`${summary.totalSkippedRows} row${summary.totalSkippedRows === 1 ? '' : 's'} skipped`
			);
		}
		if (summary.ignoredSheetCount > 0) {
			parts.push(`${summary.ignoredSheetCount} ignored`);
		}
		return parts.join(' · ') || 'Business data imported.';
	}

	async function handleApplyImport(): Promise<void> {
		if (isFinishingSetup || setupImportState.isImporting || setupImportState.isLoading) return;
		const session = dialogSession;
		const workbook = setupImportState.workbook;
		if (!workbook) return;
		if (!hasPendingCompletion) {
			try {
				const summary = await setupImportState.applyImport();
				if (!summary || summary.sheetResults.length === 0) return;
				if (!open || dialogSession !== session || setupImportState.workbook !== workbook) return;
				toast.success('Import complete', {
					description: buildImportSuccessDescription()
				});
			} catch {
				// setupImportState owns import errors.
				return;
			}
		}
		if (!open || dialogSession !== session || setupImportState.workbook !== workbook) return;
		isFinishingSetup = true;
		try {
			await onImported?.();
			if (open && dialogSession === session && setupImportState.workbook === workbook)
				closeDialog();
		} catch {
			// The callback reports setup errors. Retry it without applying committed sheets again.
			if (open && dialogSession === session && setupImportState.workbook === workbook) {
				pendingCompletionWorkbook = workbook;
			}
		} finally {
			if (dialogSession === session) isFinishingSetup = false;
		}
	}

	function getUploadPrompt(): string {
		if (isDraggingOver) {
			return 'Drop spreadsheet now';
		}

		if (setupImportState.sourcePath) {
			return 'Drop a spreadsheet here or click to replace the current file';
		}

		return 'Drop spreadsheet here or click to browse';
	}

	function isSupportedSpreadsheetPath(path: string): boolean {
		const extension = path.split('.').pop()?.toLowerCase() ?? '';
		return SUPPORTED_SPREADSHEET_EXTENSIONS.includes(extension);
	}

	async function loadPath(path: string, session = dialogSession): Promise<void> {
		if (
			!open ||
			dialogSession !== session ||
			isFinishingSetup ||
			setupImportState.isImporting ||
			setupImportState.isLoading
		)
			return;
		const workbook = setupImportState.workbook;
		let analysisStarted = false;
		try {
			const readablePath = await allowExternalFileRead(path);
			if (!open || dialogSession !== session) return;
			const fileName = readablePath.split(/[/\\]/).filter(Boolean).at(-1) ?? readablePath;
			const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
			if (extension === 'csv') {
				const text = await readTextFile(readablePath);
				if (
					!open ||
					dialogSession !== session ||
					isFinishingSetup ||
					setupImportState.isImporting ||
					setupImportState.isLoading ||
					setupImportState.workbook !== workbook
				)
					return;
				analysisStarted = true;
				await setupImportState.loadFile({ fileName, sourcePath: readablePath, text });
				return;
			}

			const bytes = await readFile(readablePath);
			if (
				!open ||
				dialogSession !== session ||
				isFinishingSetup ||
				setupImportState.isImporting ||
				setupImportState.isLoading ||
				setupImportState.workbook !== workbook
			)
				return;
			analysisStarted = true;
			await setupImportState.loadFile({ fileName, sourcePath: readablePath, bytes });
		} catch (error) {
			if (!analysisStarted && open && dialogSession === session) {
				await errorState.catchError(error, 'Read setup spreadsheet');
			}
			// setupImportState reports failures once workbook analysis has started.
		}
	}

	async function handleSelectedPaths(paths: string[]): Promise<void> {
		if (isFinishingSetup || setupImportState.isImporting || setupImportState.isLoading) return;
		const supportedPaths = paths.filter((path) => isSupportedSpreadsheetPath(path));
		if (supportedPaths.length === 0) {
			toast.error('Drop a CSV or XLSX spreadsheet.');
			return;
		}

		if (supportedPaths.length > 1) {
			toast.warning('Only one spreadsheet is supported right now. Using the first valid file.');
		}

		await loadPath(supportedPaths[0]);
	}

	async function handleBrowse(): Promise<void> {
		if (
			!isTauri() ||
			isFinishingSetup ||
			setupImportState.isImporting ||
			setupImportState.isLoading
		)
			return;
		const session = dialogSession;
		try {
			const selected = await openDialog({
				multiple: false,
				filters: [{ name: 'Spreadsheet', extensions: [...SUPPORTED_SPREADSHEET_EXTENSIONS] }]
			});
			if (typeof selected !== 'string') return;
			await loadPath(selected, session);
		} catch (error) {
			if (open && dialogSession === session) {
				await errorState.catchError(error, 'Choose setup spreadsheet');
			}
		}
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		isDraggingOver = true;
	}

	function handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		isDraggingOver = false;
	}

	$effect(() => {
		dialogSession += 1;
		if (open) return;
		isDraggingOver = false;
		isFinishingSetup = false;
		pendingCompletionWorkbook = null;
		untrack(() => setupImportState.clear());
	});

	onDestroy(() => {
		dialogSession += 1;
		if (open) setupImportState.clear();
	});

	$effect(() => {
		if (pendingCompletionWorkbook && pendingCompletionWorkbook !== setupImportState.workbook) {
			pendingCompletionWorkbook = null;
		}
	});

	onMount(() => {
		if (!isTauri()) return;
		const webview = getCurrentWebviewWindow();
		const unlisten = webview.onDragDropEvent(async (event) => {
			if (!open) return;
			if (event.payload.type === 'over') {
				isDraggingOver = true;
				return;
			}
			if (event.payload.type === 'leave') {
				isDraggingOver = false;
				return;
			}
			if (event.payload.type !== 'drop') return;
			isDraggingOver = false;
			await handleSelectedPaths(event.payload.paths);
		});

		return () => {
			unlisten.then((stop) => stop());
		};
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class={`flex min-h-0 flex-col overflow-hidden ${
			setupImportState.hasAnalysis
				? 'dialog-shell-workflow ui-dialog-workbench ui-dialog-import-workbench'
				: 'dialog-shell-form ui-dialog-size-lg'
		}`}
	>
		{#if setupImportState.hasAnalysis && setupImportState.activeSheet}
			{@const activeSheet = setupImportState.activeSheet}
			{@const orderedSheets = getOrderedSheets()}
			{@const preview = setupImportState.activeSheetPreview}
			{@const activeWorkbookSheet =
				setupImportState.workbook?.sheets.find((sheet) => sheet.sheetId === activeSheet.sheetId) ??
				null}
			{@const reviewCounts = getReviewCounts(activeSheet)}
			{@const duplicateSummary = setupImportState.getSheetDuplicateSummary(activeSheet.sheetId)}
			{@const canShowMapper = canShowMappingGrid(activeSheet)}
			{@const activeSheetSessionState = setupImportState.getSheetSessionState(activeSheet.sheetId)}
			{@const activeSheetImportSummary = formatImportResultSummary(activeSheet.sheetId)}
			{@const repeatedValueIssues = setupImportState.getRepeatedValueIssues(activeSheet.sheetId)}
			{@const showDuplicateControls =
				canShowMapper &&
				(preview?.validRows.length ?? 0) > 0 &&
				!!activeSheet.targetTable &&
				(duplicateSummary?.matchedRowCount ?? 0) > 0}

			<Dialog.Header class="ui-dialog-frame-header shrink-0">
				<div class="flex min-w-0 items-center gap-2">
					<FileSpreadsheetIcon class="size-4 opacity-70" />
					<Dialog.Title class="title-copy truncate">
						{setupImportState.sourcePath?.split(/[/\\]/).filter(Boolean).at(-1) ??
							'Spreadsheet ready'}
					</Dialog.Title>
					<Meta class="truncate">· {getWorkbookSummaryLine(orderedSheets)}</Meta>
				</div>
			</Dialog.Header>

			<div
				class="ui-dialog-frame-body ui-dialog-workbench-body min-h-0 flex-1 overflow-hidden px-4"
				inert={setupImportState.isImporting ||
					setupImportState.isLoading ||
					isFinishingSetup ||
					hasPendingCompletion ||
					setupImportState.hasPendingImportRefresh}
			>
				<div class="grid h-full min-h-0 gap-4 overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)]">
					<aside class="min-h-0 overflow-y-auto py-4">
						<div class="grid gap-2">
							{#each orderedSheets as sheet (sheet.sheetId)}
								<button
									type="button"
									class={[
										'ui-choice-card ui-choice-card-compact text-left',
										getSheetCardToneClasses(sheet),
										getSheetActiveClasses(sheet)
									]}
									onclick={() => setupImportState.setActiveSheet(sheet.sheetId)}
								>
									<div class="grid gap-1">
										<div class="flex min-w-0 items-start justify-between gap-3">
											<div class="min-w-0 space-y-1">
												<Text class="truncate">{sheet.sheetName}</Text>
												<Meta class={`truncate ${getSheetStatusTextClasses(sheet)}`}>
													{sheet.targetTable ? getSelectedTableLabel(sheet) : 'Choose import table'}
												</Meta>
											</div>
											<div
												class={`ui-radius-pill mt-1 size-2 shrink-0 ${getSheetStatusDotClasses(sheet)}`}
												aria-hidden="true"
											></div>
										</div>
										<Meta class="truncate">{getSheetSummaryMeta(sheet)}</Meta>
									</div>
								</button>
							{/each}
						</div>
					</aside>

					<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden py-4 pe-2">
						<div class="shrink-0 space-y-4 pb-3">
							<div class={getActiveSheetHeaderLayout(activeSheet, showDuplicateControls)}>
								<div class="min-w-0 space-y-1.5">
									<div class="flex min-w-0 flex-wrap items-center gap-2">
										<h2 class="title-copy truncate">{activeSheet.sheetName}</h2>
										<div
											class={`ui-radius-pill size-2 shrink-0 ${getSheetStatusDotClasses(activeSheet)}`}
											aria-hidden="true"
										></div>
										<Meta class={getSheetStatusTextClasses(activeSheet)}>
											{getSheetStatusLabel(activeSheet)}
										</Meta>
										{#if activeSheet.targetTable}
											<Meta class="truncate">· {getSelectedTableLabel(activeSheet)}</Meta>
										{/if}
									</div>
									<Meta>{getSheetGuidance(activeSheet)}</Meta>
									{#if canShowMapper}
										<Meta>
											{reviewCounts.green} matched · {reviewCounts.yellow} check · {reviewCounts.red}
											need mapping
											{#if reviewCounts.ignored > 0}
												· {reviewCounts.ignored} ignored
											{/if}
										</Meta>
									{/if}
									{#if activeSheetImportSummary}
										<Meta>
											{activeSheetSessionState === 'dirty_after_import'
												? `Previously imported · ${activeSheetImportSummary}`
												: activeSheetImportSummary}
										</Meta>
									{/if}
								</div>

								<div
									class={`grid max-w-3xl gap-3 ${getActiveSheetControlColumns(activeSheet, showDuplicateControls)}`}
								>
									<div class="grid max-w-md min-w-0 gap-1.5">
										<div class="flex items-center gap-2">
											<FieldLabel class="whitespace-nowrap">Import into</FieldLabel>
											<FormHelpTooltip content="Choose the table this sheet should import into." />
										</div>
										<Select.Root
											type="single"
											value={getSheetTargetValue(activeSheet)}
											onValueChange={(value) =>
												setupImportState.updateSheetTargetTable(
													activeSheet.sheetId,
													value === IGNORE_TABLE_VALUE ? null : (value as SetupImportTargetTable)
												)}
										>
											<Select.Trigger size="default" class="w-full min-w-0">
												<span class="block min-w-0 truncate">
													{getSelectedTableLabel(activeSheet)}
												</span>
											</Select.Trigger>
											<Select.Content side="right" align="start" class="menu-width-standard">
												<Select.Item value={IGNORE_TABLE_VALUE}>Ignore sheet</Select.Item>
												{#each TARGET_TABLE_OPTIONS as option (option.value)}
													<Select.Item value={option.value}>{option.label}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</div>

									{#if activeSheet.targetTable === 'cost_codes'}
										<div class="grid max-w-md min-w-0 gap-1.5">
											<div class="flex items-center gap-2 px-1">
												<FieldLabel class="whitespace-nowrap">Classification system</FieldLabel>
												<FormHelpTooltip
													content="Cost codes need to be linked to an existing system or a system being imported in this workbook."
												/>
											</div>
											{#if hasSingleClassificationSystemOption(activeSheet.sheetId)}
												<div class="ui-inline-summary gap-2">
													<span class="field-copy min-w-0 truncate">
														{getSelectedClassificationSystemLabel(activeSheet.sheetId)}
													</span>
													<span class="shell-meta shrink-0 opacity-60">Selected automatically</span>
												</div>
											{:else}
												<Select.Root
													type="single"
													value={setupImportState.costCodeSystemSelections.get(
														activeSheet.sheetId
													) ?? ''}
													onValueChange={(value) =>
														setupImportState.setCostCodeSystemSelection(
															activeSheet.sheetId,
															value || null
														)}
												>
													<Select.Trigger size="default" class="w-full min-w-0">
														<span class="block min-w-0 truncate">
															{getSelectedClassificationSystemLabel(activeSheet.sheetId)}
														</span>
													</Select.Trigger>
													<Select.Content side="right" align="start" class="menu-width-standard">
														{#each getClassificationSystemOptions(activeSheet.sheetId) as option (option.value)}
															<Select.Item value={option.value}>
																{getClassificationSystemOptionLabel(option)}
															</Select.Item>
														{/each}
													</Select.Content>
												</Select.Root>
											{/if}
										</div>
									{:else if showDuplicateControls}
										<div class="grid max-w-md min-w-0 gap-1.5">
											<div class="flex items-center gap-2 px-1">
												<FieldLabel>Matches exist</FieldLabel>
												<FormHelpTooltip
													content={getImportModeTooltip(
														setupImportState.getSheetImportMode(activeSheet.sheetId)
													)}
												/>
											</div>
											<Select.Root
												type="single"
												value={setupImportState.getSheetImportMode(activeSheet.sheetId)}
												onValueChange={(value) =>
													setupImportState.setSheetImportMode(
														activeSheet.sheetId,
														value as SetupImportDuplicateMode
													)}
											>
												<Select.Trigger size="default" class="w-full">
													{getImportModeLabel(
														setupImportState.getSheetImportMode(activeSheet.sheetId)
													)}
												</Select.Trigger>
												<Select.Content class="menu-width-standard">
													{#each IMPORT_MODE_OPTIONS as option (option.value)}
														<Select.Item value={option.value}>{option.label}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										</div>
									{/if}
								</div>
							</div>
						</div>

						<div class="scrollbar-activate-y min-h-0 flex-1 overflow-y-auto pr-1">
							<div class="grid gap-4">
								{#if showDuplicateControls && duplicateSummary}
									<Alert.Root variant="warning" class="shadow-none">
										<AlertCircleIcon />
										<div class="space-y-1">
											<Alert.Title>Mapping still needs review</Alert.Title>
											<Alert.Description class="shell-label text-current/86">
												{duplicateSummary.matchedRowCount} matched row{duplicateSummary.matchedRowCount ===
												1
													? ''
													: 's'} and {duplicateSummary.newRowCount} new row{duplicateSummary.newRowCount ===
												1
													? ''
													: 's'} detected.
											</Alert.Description>
										</div>
									</Alert.Root>
								{/if}

								{#if !activeSheet.targetTable && !isSheetIgnored(activeSheet.sheetId)}
									<Alert.Root class="shadow-none">
										<FileSpreadsheetIcon />
										<div class="grid gap-1.5">
											<Alert.Title>Choose the import table to start mapping this sheet.</Alert.Title
											>
											<Alert.Description>
												{getAvailableColumnCount(activeSheet)} column{getAvailableColumnCount(
													activeSheet
												) === 1
													? ''
													: 's'} detected.
											</Alert.Description>
										</div>
									</Alert.Root>
								{:else if !activeSheet.targetTable && isSheetIgnored(activeSheet.sheetId)}
									<Alert.Root class="shadow-none">
										<FileSpreadsheetIcon />
										<div class="grid gap-1.5">
											<Alert.Title>Sheet will be skipped</Alert.Title>
											<Alert.Description>
												This sheet is ignored for this import. Choose a table above if you want to
												include it.
											</Alert.Description>
										</div>
									</Alert.Root>
								{:else if (activeWorkbookSheet?.headerIssues.length ?? 0) > 0}
									<Alert.Root variant="destructive" class="shadow-none">
										<AlertCircleIcon />
										<div class="grid gap-1.5">
											<Alert.Title>Spreadsheet header issues</Alert.Title>
											<Alert.Description
												>{activeWorkbookSheet?.headerIssues.join(', ')}</Alert.Description
											>
										</div>
									</Alert.Root>
								{/if}

								{#if canShowMapper && hasMappingIssues(activeSheet)}
									<Alert.Root variant="warning" class="shadow-none">
										<AlertCircleIcon />
										<div class="grid gap-1.5">
											<Alert.Title>Mapping still needs review</Alert.Title>
											<Alert.Description class="shell-label text-current/86">
												{#if activeSheet.missingRequiredFields.length > 0}
													<p>
														Required fields:
														{getFriendlyMissingRequiredFields(activeSheet).join(', ')}
													</p>
												{/if}
												{#if activeSheet.unmatchedColumns.length > 0}
													<div class="flex items-center gap-2">
														<p>
															{activeSheet.unmatchedColumns.length} column{activeSheet
																.unmatchedColumns.length === 1
																? ''
																: 's'} still need a field
														</p>
														<FormHelpTooltip
															content={`Columns still needing a field: ${activeSheet.unmatchedColumns.join(', ')}`}
														/>
													</div>
												{/if}
												{#if reviewCounts.yellow > 0}
													<p>
														Confirm {reviewCounts.yellow} suggested match{reviewCounts.yellow === 1
															? ''
															: 'es'} to continue.
													</p>
												{/if}
											</Alert.Description>
										</div>
									</Alert.Root>
								{/if}

								{#if canShowMapper && isSheetClean(activeSheet, preview)}
									<Alert.Root variant="success" class="shadow-none">
										<CheckCircle2Icon />
										<div class="grid gap-1.5">
											<Alert.Title>Sheet ready to import</Alert.Title>
											<Alert.Description class="shell-label text-current/86">
												All required fields are mapped and the current rows are valid.
											</Alert.Description>
										</div>
									</Alert.Root>
								{/if}

								{#if canShowMapper}
									<div class="ui-table-surface">
										<div class="overflow-x-auto">
											<Table.Root>
												<Table.Header>
													<Table.Row>
														<Table.Head>Source column</Table.Head>
														<Table.Head class="w-64">Import as</Table.Head>
														<Table.Head class="w-56">Status</Table.Head>
													</Table.Row>
												</Table.Header>
												<Table.Body>
													{#each activeSheet.mappings as mapping (mapping.sourceColumn)}
														<Table.Row>
															<Table.Cell>
																{@const sampleValue =
																	getSampleValue(activeSheet.sheetId, mapping.sourceColumn) ||
																	'No sample values'}
																<div class="grid min-w-0 gap-1">
																	<Text class="truncate">{mapping.sourceColumn}</Text>
																	<div class="max-w-lg" title={sampleValue}>
																		<Meta class="truncate">{sampleValue}</Meta>
																	</div>
																</div>
															</Table.Cell>
															<Table.Cell class="w-64 align-middle">
																<Select.Root
																	type="single"
																	value={getMappingTargetValue(mapping)}
																	onValueChange={(value) =>
																		setupImportState.updateSheetMapping(
																			activeSheet.sheetId,
																			mapping.sourceColumn,
																			value === IGNORE_FIELD_VALUE
																				? null
																				: value === UNRESOLVED_FIELD_VALUE
																					? null
																					: value,
																			{ ignored: value === IGNORE_FIELD_VALUE }
																		)}
																>
																	<Select.Trigger size="default" class="w-full min-w-0">
																		<span class="block min-w-0 truncate">
																			{getMappingTriggerLabel(activeSheet.sheetId, mapping)}
																		</span>
																	</Select.Trigger>
																	<Select.Content class="menu-width-standard">
																		<Select.Item value={UNRESOLVED_FIELD_VALUE}>
																			Choose field
																		</Select.Item>
																		<Select.Item value={IGNORE_FIELD_VALUE}
																			>Ignore column</Select.Item
																		>
																		{#each getTargetFieldSelectOptions(activeSheet.sheetId) as option (option.value)}
																			<Select.Item value={option.value}>
																				<span
																					class="block min-w-0 truncate"
																					title={option.description}
																				>
																					{option.label}
																				</span>
																			</Select.Item>
																		{/each}
																	</Select.Content>
																</Select.Root>
															</Table.Cell>
															<Table.Cell class="w-56 align-middle">
																<div class="grid gap-1">
																	<div class="flex items-center gap-2 whitespace-nowrap">
																		<Badge
																			variant={getMappingStatusVariant(mapping.status)}
																			class={`shrink-0 ${getMappingStatusClasses(mapping.status)}`}
																		>
																			{getMappingStatusLabel(mapping.status)}
																		</Badge>
																		{#if mapping.status === 'yellow' && mapping.targetField}
																			<Button
																				variant="ghost"
																				size="icon-sm"
																				class=""
																				onclick={() =>
																					setupImportState.confirmSuggestedMapping(
																						activeSheet.sheetId,
																						mapping.sourceColumn
																					)}
																			>
																				<CheckIcon class="size-3.5" />
																			</Button>
																		{/if}
																		<div class="shrink-0">
																			<FormHelpTooltip content={getMappingStatusTooltip(mapping)} />
																		</div>
																	</div>
																</div>
															</Table.Cell>
														</Table.Row>
													{/each}
												</Table.Body>
											</Table.Root>
										</div>
									</div>
								{/if}

								{#if canShowMapper && preview && !preview.rowValidationDeferred && repeatedValueIssues.length > 0}
									<Alert.Root variant="warning" class="shadow-none">
										<AlertCircleIcon />
										<div class="grid gap-1.5">
											<Alert.Title>Resolve repeated values</Alert.Title>
											<Alert.Description>
												Apply one remap for repeated source values before fixing one-off rows below.
											</Alert.Description>
											<div class="grid gap-3 pt-1">
												{#each repeatedValueIssues as repeated (`${repeated.fieldId}-${repeated.rawValue}`)}
													<Panel
														as="div"
														class="grid gap-2 border-warning/20 md:grid-cols-[minmax(0,1fr)_16rem] md:items-end"
													>
														<div class="grid gap-1">
															<Text>
																{getRepeatedValueSummary(
																	activeSheet,
																	repeated.fieldId,
																	repeated.rawValue,
																	repeated.rowNumbers.length
																)}
															</Text>
															<Meta>
																Rows {repeated.rowNumbers.join(', ')} · {getRowFixFieldGuidance(
																	activeSheet,
																	preview.errors.find((issue) =>
																		repeated.rowNumbers.includes(issue.rowNumber)
																	) ?? preview.errors[0],
																	repeated.fieldId
																)}
															</Meta>
														</div>
														<Select.Root
															type="single"
															value={setupImportState.getBulkValueRemap(
																activeSheet.sheetId,
																repeated.fieldId,
																repeated.rawValue
															)}
															onValueChange={(value) =>
																setupImportState.applyBulkValueRemap(
																	activeSheet.sheetId,
																	repeated.fieldId,
																	repeated.rawValue,
																	value
																)}
														>
															<Select.Trigger size="default" class="w-full">
																{getRowFixFieldOptions(activeSheet, repeated.fieldId)?.find(
																	(option) =>
																		option.value ===
																		setupImportState.getBulkValueRemap(
																			activeSheet.sheetId,
																			repeated.fieldId,
																			repeated.rawValue
																		)
																)?.label ??
																	`Choose ${getRowFixFieldLabel(activeSheet, repeated.fieldId).toLowerCase()}`}
															</Select.Trigger>
															<Select.Content>
																{#each getRowFixFieldOptions(activeSheet, repeated.fieldId) ?? [] as option (option.value)}
																	<Select.Item value={option.value}>{option.label}</Select.Item>
																{/each}
															</Select.Content>
														</Select.Root>
													</Panel>
												{/each}
											</div>
										</div>
									</Alert.Root>
								{/if}

								{#if canShowMapper && preview && !preview.rowValidationDeferred && preview.validRows.length > 0}
									<Panel as="div" class="grid gap-2">
										<div class="flex items-center gap-2">
											<CheckCircle2Icon class="size-4 opacity-70" />
											<Text>
												{preview.errors.length > 0 ? 'Valid rows found' : 'Rows ready to import'}
											</Text>
										</div>
										<Meta>{getPreviewSummary(activeSheet, preview)}</Meta>
										<div class="ui-table-surface">
											<div class="overflow-x-auto">
												<Table.Root>
													<Table.Header>
														<Table.Row>
															{#each getPreviewColumns(activeSheet, preview) as column (column.fieldId)}
																<Table.Head>{column.label}</Table.Head>
															{/each}
														</Table.Row>
													</Table.Header>
													<Table.Body>
														{#each preview.validRows.slice(0, 5) as row, index (`preview-${activeSheet.sheetId}-${index}`)}
															<Table.Row>
																{#each getPreviewColumns(activeSheet, preview) as column (column.fieldId)}
																	{@const previewValue = getPreviewCellValue(row, column.fieldId)}
																	<Table.Cell>
																		<div title={previewValue}>
																			<Meta class="truncate">{previewValue}</Meta>
																		</div>
																	</Table.Cell>
																{/each}
															</Table.Row>
														{/each}
													</Table.Body>
												</Table.Root>
											</div>
										</div>
									</Panel>
								{/if}

								{#if canShowMapper && preview && !preview.rowValidationDeferred && preview.errors.length > 0}
									<Alert.Root variant="destructive" class="shadow-none">
										<AlertCircleIcon />
										<div class="grid gap-1.5">
											<Alert.Title>Source rows still need fixing</Alert.Title>
											<Alert.Description>
												<p>{getRowIssueCardSummary(activeSheet, preview)}</p>
											</Alert.Description>
											<div class="grid gap-3 pt-1">
												{#each preview.errors as issue (issue.rowNumber)}
													{@const repairableFieldIds = getRepairableRowFixFields(issue)}
													{@const issueNeedsSpreadsheetRepair = rowNeedsSpreadsheetRepair(issue)}
													<Panel as="div" class="border-destructive/20">
														<div class="grid gap-1">
															<div class="flex items-center justify-between gap-3">
																<Text>Row {issue.rowNumber}</Text>
																<div class="flex items-center gap-2">
																	<Meta
																		>{repairableFieldIds.length || 1} field{(repairableFieldIds.length ||
																			1) === 1
																			? ''
																			: 's'} need attention</Meta
																	>
																	<FormHelpTooltip
																		content={getRowFixRowSummary(activeSheet, issue)}
																	/>
																</div>
															</div>
															<Meta>{getRowFixIssueSummary(activeSheet, issue)}</Meta>
														</div>
														{#if issueNeedsSpreadsheetRepair}
															<Alert.Root variant="destructive" class="mt-3 shadow-none">
																<AlertCircleIcon />
																<div class="space-y-1">
																	<Alert.Title>Fix this row in the spreadsheet</Alert.Title>
																	<Alert.Description>
																		Kwantflow can repair mapped values like units, countries, and
																		numbers here, but complex template or component data needs to be
																		corrected in the source file first.
																	</Alert.Description>
																</div>
															</Alert.Root>
															<div class="mt-3 flex items-center justify-end gap-2">
																<Button
																	variant="secondary"
																	size="default"
																	onclick={() =>
																		setupImportState.skipRow(activeSheet.sheetId, issue.rowNumber)}
																>
																	Skip row
																</Button>
															</div>
														{:else if repairableFieldIds.length > 0}
															<div class="mt-3 grid gap-3 sm:grid-cols-2">
																{#each repairableFieldIds as fieldId (fieldId)}
																	<div class="grid gap-1.5">
																		<div class="grid gap-1">
																			<div class="flex items-center gap-2">
																				<FieldLabel>
																					{getRowFixFieldLabel(activeSheet, fieldId)}
																				</FieldLabel>
																				{#if getRowFixFieldGuidance(activeSheet, issue, fieldId)}
																					<FormHelpTooltip
																						content={getRowFixFieldGuidance(
																							activeSheet,
																							issue,
																							fieldId
																						)}
																					/>
																				{/if}
																			</div>
																			{#if getRowFixSourceValueLabel(issue, fieldId)}
																				<Meta>
																					Source value: {getRowFixSourceValueLabel(issue, fieldId)}
																				</Meta>
																			{/if}
																		</div>
																		{#if getRowFixFieldKind(activeSheet, fieldId) === 'select' && getRowFixFieldOptions(activeSheet, fieldId)}
																			<Select.Root
																				type="single"
																				value={getRowFixFieldValue(
																					activeSheet.sheetId,
																					issue,
																					fieldId
																				)}
																				onValueChange={(value) =>
																					setupImportState.updateRowFieldOverride(
																						activeSheet.sheetId,
																						issue.rowNumber,
																						fieldId,
																						value
																					)}
																			>
																				<Select.Trigger size="default" class="w-full min-w-0">
																					<span class="block min-w-0 truncate">
																						{getRowFixFieldOptions(activeSheet, fieldId)?.find(
																							(option) =>
																								option.value ===
																								getRowFixFieldValue(
																									activeSheet.sheetId,
																									issue,
																									fieldId
																								)
																						)?.label ??
																							`Choose ${getRowFixFieldLabel(activeSheet, fieldId).toLowerCase()}`}
																					</span>
																				</Select.Trigger>
																				<Select.Content>
																					{#each getRowFixFieldOptions(activeSheet, fieldId) ?? [] as option (option.value)}
																						<Select.Item value={option.value}
																							>{option.label}</Select.Item
																						>
																					{/each}
																				</Select.Content>
																			</Select.Root>
																		{:else if getRowFixFieldKind(activeSheet, fieldId) === 'textarea'}
																			<Textarea
																				class="min-h-24"
																				placeholder={getRowFixFieldPlaceholder(fieldId)}
																				value={getRowFixFieldValue(
																					activeSheet.sheetId,
																					issue,
																					fieldId
																				)}
																				oninput={(event) =>
																					setupImportState.setRowFieldDraft(
																						activeSheet.sheetId,
																						issue.rowNumber,
																						fieldId,
																						(event.currentTarget as HTMLTextAreaElement).value
																					)}
																			/>
																		{:else if getRowFixFieldKind(activeSheet, fieldId) === 'number'}
																			<Input
																				type="number"
																				step={fieldId === 'sort_order' ? '1' : '0.01'}
																				class="text-right tabular-nums"
																				placeholder={getRowFixFieldPlaceholder(fieldId)}
																				value={getRowFixFieldValue(
																					activeSheet.sheetId,
																					issue,
																					fieldId
																				)}
																				oninput={(event) =>
																					setupImportState.setRowFieldDraft(
																						activeSheet.sheetId,
																						issue.rowNumber,
																						fieldId,
																						(event.currentTarget as HTMLInputElement).value
																					)}
																			/>
																		{:else}
																			<Input
																				placeholder={getRowFixFieldPlaceholder(fieldId)}
																				value={getRowFixFieldValue(
																					activeSheet.sheetId,
																					issue,
																					fieldId
																				)}
																				oninput={(event) =>
																					setupImportState.setRowFieldDraft(
																						activeSheet.sheetId,
																						issue.rowNumber,
																						fieldId,
																						(event.currentTarget as HTMLInputElement).value
																					)}
																			/>
																		{/if}
																	</div>
																{/each}
															</div>
															<div class="mt-3 flex items-center justify-end gap-2">
																{#if setupImportState.hasRowRemediationState(activeSheet.sheetId, issue.rowNumber)}
																	<Button
																		variant="secondary"
																		size="default"
																		onclick={() =>
																			setupImportState.resetRowFix(
																				activeSheet.sheetId,
																				issue.rowNumber
																			)}
																	>
																		Reset row
																	</Button>
																{/if}
																<Button
																	variant="secondary"
																	size="default"
																	onclick={() =>
																		setupImportState.skipRow(activeSheet.sheetId, issue.rowNumber)}
																>
																	Skip row
																</Button>
																<Button
																	variant="brand"
																	size="default"
																	class="gap-2"
																	disabled={!setupImportState.hasRowDrafts(
																		activeSheet.sheetId,
																		issue.rowNumber
																	)}
																	onclick={() =>
																		setupImportState.applyRowFix(
																			activeSheet.sheetId,
																			issue.rowNumber
																		)}
																>
																	<CheckIcon class="size-4" />
																	Apply fix
																</Button>
															</div>
														{/if}
													</Panel>
												{/each}
											</div>
										</div>
									</Alert.Root>
								{/if}

								{#if canShowMapper && preview && !preview.rowValidationDeferred && (preview.skippedRowCount ?? 0) > 0}
									<Panel as="div" class="border-border/60">
										<Text>
											{getSkippedRowSummary(activeSheet.sheetId)}
										</Text>
										<div class="mt-2 flex flex-wrap gap-2">
											{#each setupImportState.getSkippedRowNumbers(activeSheet.sheetId) as rowNumber (rowNumber)}
												<Button
													variant="secondary"
													size="default"
													onclick={() => setupImportState.unskipRow(activeSheet.sheetId, rowNumber)}
												>
													Unskip row {rowNumber}
												</Button>
											{/each}
										</div>
									</Panel>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>

			<Dialog.Footer class="ui-dialog-frame-footer shrink-0 sm:justify-end">
				<div class="flex flex-wrap items-center justify-end gap-2">
					<Button
						variant="secondary"
						size="default"
						class="gap-2"
						onclick={handleBrowse}
						disabled={setupImportState.isLoading ||
							setupImportState.isImporting ||
							isFinishingSetup}
					>
						<UploadIcon class="size-4" />
						{setupImportState.isLoading ? 'Analysing...' : 'Replace file'}
					</Button>
					<Button
						variant="secondary"
						size="default"
						onclick={closeDialog}
						disabled={isFinishingSetup}>Close</Button
					>
					<Button
						variant="brand"
						size="default"
						class="gap-2"
						onclick={handleApplyImport}
						disabled={(!hasPendingCompletion &&
							!setupImportState.hasPendingImportRefresh &&
							!setupImportState.getImportPreflight().canApply) ||
							setupImportState.isLoading ||
							setupImportState.isImporting ||
							isFinishingSetup}
					>
						{getPrimaryImportLabel()}
					</Button>
				</div>
			</Dialog.Footer>
		{:else}
			<Dialog.Header class="ui-dialog-frame-header shrink-0">
				<Dialog.Title>Import Business Data</Dialog.Title>
			</Dialog.Header>
			<div class="ui-dialog-frame-body flex min-h-0 flex-1 items-center justify-center p-5">
				<div
					role="region"
					aria-label="Spreadsheet upload drop zone"
					data-upload-mode="drag-drop"
					class={`ui-upload-dropzone ui-empty-dropzone-lg w-full px-6 py-8 ${
						isDraggingOver ? 'ui-upload-dropzone-active' : ''
					}`}
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
				>
					<UploadIcon class="size-7 opacity-70" />
					<Text class="mt-4">{getUploadPrompt()}</Text>
					<div class="mt-3 flex flex-col items-center gap-2 text-center">
						<Meta>CSV and XLSX only.</Meta>
						<div class="flex items-center gap-1.5">
							<Meta>Review mappings before import.</Meta>
							<FormHelpTooltip
								content={`Column names do not need to match exactly. The wizard will match likely fields from names, keywords, and aliases during review. ${SETUP_IMPORT_ALIAS_UPLOAD_HELP}`}
							/>
						</div>
					</div>
					<div class="mt-4">
						<Button
							variant="brand"
							size="default"
							class="gap-2"
							onclick={handleBrowse}
							disabled={setupImportState.isLoading ||
								setupImportState.isImporting ||
								isFinishingSetup}
						>
							<UploadIcon class="size-4" />
							{setupImportState.isLoading ? 'Analysing...' : 'Choose File'}
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
