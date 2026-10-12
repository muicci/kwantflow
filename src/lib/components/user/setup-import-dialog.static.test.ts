import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/user/setup-import-dialog.svelte');
const themePath = join(process.cwd(), 'src/lib/design/theme.css');

describe('setup import dialog', () => {
	it('keeps the compact split-sheet mapper and upload flow', () => {
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('Import Business Data');
		expect(source).toContain('extensions: [...SUPPORTED_SPREADSHEET_EXTENSIONS]');
		expect(source).toContain('setupImportState.hasAnalysis');
		expect(source).toContain(
			'dialog-shell-workflow ui-dialog-workbench ui-dialog-import-workbench'
		);
		expect(source).toContain('Drop spreadsheet here or click to browse');
		expect(source).toContain('Choose the import table to start mapping this sheet.');
		expect(source).toContain('CSV and XLSX only.');
		expect(source).toContain('Review mappings before import.');
		expect(source).toContain('Column names do not need to match exactly.');
		expect(source).toContain('Import into');
		expect(source).toContain('Matches exist');
		expect(source).toContain('Classification system');
		expect(source).toContain('Selected automatically');
		expect(source).toContain('Enter digits only');
		expect(source).toContain('placeholder={getRowFixFieldPlaceholder(fieldId)}');
		expect(source).toContain('Replace file');
		expect(source).toContain('Rows ready to import');
		expect(source).toContain('Valid rows found');
		expect(source).toContain('Source rows still need fixing');
		expect(source).toContain('Resolve repeated values');
		expect(source).toContain('Mapping still needs review');
		expect(source).toContain('Sheet ready to import');
		expect(source).toContain('Review the blocked rows below.');
		expect(source).toContain('Fix this row in the spreadsheet');
		expect(source).toContain('source file first');
		expect(source).toContain('Resolve remaining sheets');
		expect(source).toContain('Sheet will be skipped');
		expect(source).toContain('mixed email data');
		expect(source).toContain('mixed phone data');
		expect(source).toContain('Source value:');
		expect(source).toContain('Choose field');
		expect(source).toContain('Needs mapping');
		expect(source).toContain('Ignored');
		expect(source).toContain('UNRESOLVED_FIELD_VALUE');
		expect(source).toContain('Import complete');
		expect(source).toContain('toast.success(');
		expect(source).toContain('handleApplyImport');
		expect(source).toContain('onImported');
		expect(source).toContain('Ignore column');
		expect(source).toContain('Ignore sheet');
		expect(source).toContain('UNASSIGNED_TABLE_VALUE');
		expect(source).toContain('getSelectedTableLabel(activeSheet)');
		expect(source).toContain(
			'ui-dialog-frame-body ui-dialog-workbench-body min-h-0 flex-1 overflow-hidden px-4'
		);
		expect(source).toContain('gap-4 overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)]');
		expect(source).toContain('ui-dialog-frame-footer shrink-0 sm:justify-end');
		expect(source).toContain('ui-table-surface');
		expect(source).toContain('getSheetCardToneClasses(sheet)');
		expect(source).toContain('getSheetStatusDotClasses(sheet)');
		expect(source).toContain('ui-choice-card-muted');
		expect(source).toContain('ui-choice-card-neutral');
		expect(source).toContain('ui-choice-card-selected');
		expect(source).toContain(
			"mapping.status === 'ignored' ? IGNORE_FIELD_VALUE : UNRESOLVED_FIELD_VALUE"
		);
		expect(source).toContain('title={sampleValue}');
		expect(source).toContain('setupImportState.updateRowFieldOverride(');
		expect(source).toContain('getRowFixFieldKind(activeSheet, fieldId)');
		expect(source).toContain('setRowFieldDraft(');
		expect(source).toContain('applyRowFix(');
		expect(source).toContain('hasRowRemediationState');
		expect(source).toContain('Reset row');
		expect(source).toContain('Skip row');
		expect(source).toContain('Unskip row');
		expect(source).toContain('Apply fix');
		expect(source).toContain('FormHelpTooltip');
		expect(source).toContain('content={getRowFixRowSummary(activeSheet, issue)}');
		expect(source).toContain('ui-empty-dropzone-lg');
		expect(source).toContain('sm:grid-cols-2');
		expect(source).toContain('Columns still needing a field:');
		expect(source).toContain('<Textarea');
		expect(source).toContain('<Input');
		expect(source).toContain('Choose ${getRowFixFieldLabel(activeSheet, fieldId).toLowerCase()}');
		expect(source).toContain('to review');
		expect(source).toContain('detected');
		expect(source).toContain("import * as Alert from '$lib/components/ui/alert/index.js';");
		expect(source).toContain('ui-choice-card');

		const themeSource = readFileSync(themePath, 'utf8');
		expect(themeSource).toContain('.ui-dialog-import-workbench');
		expect(themeSource).toContain('block-size: min(var(--dialog-shell-workbench-height)');
		expect(source).toContain('ui-choice-card-compact');
		expect(source).toContain('ui-inline-summary');
		expect(source).toContain('ui-table-surface');
		expect(source).toContain('<h2 class="title-copy truncate">{activeSheet.sheetName}</h2>');
		expect(source).toContain('<Alert.Root variant="success" class="shadow-none">');
		expect(source).not.toContain('Review this match');
		expect(source).not.toContain('Paste valid preset component JSON for this row.');
		expect(source).not.toContain('Paste valid estimate template JSON for this row.');
		expect(source).not.toContain(
			'<h2 class="large truncate text-foreground">{activeSheet.sheetName}</h2>'
		);
		expect(source).not.toContain('<p class="caption truncate text-warning">');
		expect(source).not.toContain('text-destructive/80');
		expect(source).not.toContain('sticky bottom-0');
		expect(source).not.toContain('Last import run');
		expect(source).not.toContain('Ask AI to try this sheet again');
		expect(source).not.toContain('Try again with AI');
		expect(source).not.toContain('showAiRetryForSheetId');
		expect(source).not.toContain('Accepted file types: CSV and XLSX.');
		expect(source).not.toContain('ui-dialog-size-setup-lg');
		expect(source).not.toContain('ui-dialog-height-setup');
		expect(source).not.toContain('Search systems...');
		expect(source).not.toContain('contentClass="ui-popover-width-lg"');
		expect(source).not.toContain('Search fields, aliases, or keywords...');
		expect(source).not.toContain('contentClass="ui-popover-width-xl"');
		expect(source).not.toContain('surface-panel ui-radius-lg overflow-x-auto border');
		expect(source).not.toContain(
			"'ui-radius-lg hover-surface-secondary border px-3 py-2.5 text-left transition-colors'"
		);
		expect(source).not.toContain("'border-primary/18 bg-accent'");
		expect(source).not.toContain("'border-border/70 bg-background'");
		expect(source).not.toContain("'ring-2 ring-primary/18 border-primary/28 bg-accent'");
	});
});
