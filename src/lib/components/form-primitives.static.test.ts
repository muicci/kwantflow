import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('form primitive contract', () => {
	it('exports the owned form and layout primitives for dialog migration work', () => {
		const source = readSource('src/lib/components/primitives/index.ts');

		expect(source).toContain("import Cluster from './cluster.svelte';");
		expect(source).toContain("import Panel from './panel.svelte';");
		expect(source).toContain("import FieldShell from './field-shell.svelte';");
		expect(source).toContain("import SectionLabel from './section-label.svelte';");
		expect(source).toContain("import FieldLabelRow from './field-label-row.svelte';");
		expect(source).toContain("import FieldError from './field-error.svelte';");
		expect(source).toContain('Cluster,');
		expect(source).toContain('FieldShell,');
		expect(source).toContain('SectionLabel,');
		expect(source).toContain('FieldLabelRow,');
		expect(source).toContain('FieldError');
	});

	it('keeps owned field controls on the shared size and invalid-tone contract', () => {
		const buttonSource = readSource('src/lib/components/ui/button/button.svelte');
		const buttonTypesSource = readSource('src/lib/components/ui/button/types.ts');
		const inputSource = readSource('src/lib/components/ui/input/input.svelte');
		const inputIndexSource = readSource('src/lib/components/ui/input/index.ts');
		const inputAffixSource = readSource('src/lib/components/ui/input/input-affix.svelte');
		const textareaSource = readSource('src/lib/components/ui/textarea/textarea.svelte');
		const selectTriggerSource = readSource('src/lib/components/ui/select/select-trigger.svelte');
		const componentTokens = readSource('tokens/components.json');

		expect(buttonTypesSource).toContain('ui-button-radius');
		expect(buttonTypesSource).not.toContain('ui-radius-md');
		expect(buttonTypesSource).toContain("xs: 'control-copy-xs ui-button-size-xs'");
		expect(buttonTypesSource).toContain('loading?: boolean;');
		expect(buttonSource).toContain('LoaderIcon');
		expect(buttonSource).toContain('aria-busy={loading || undefined}');
		expect(inputSource).toContain("size?: 'xs' | 'sm' | 'default' | 'lg';");
		expect(inputSource).toContain("invalidTone?: 'neutral' | 'destructive';");
		expect(textareaSource).toContain("size?: 'xs' | 'sm' | 'default' | 'lg';");
		expect(textareaSource).toContain("invalidTone?: 'neutral' | 'destructive';");
		expect(selectTriggerSource).toContain("size?: 'xs' | 'sm' | 'default' | 'lg';");
		expect(selectTriggerSource).toContain("invalidTone?: 'neutral' | 'destructive';");
		expect(inputSource).toContain("size === 'xs'");
		expect(inputSource).toContain("'ui-field-size-default'");
		expect(inputIndexSource).toContain("import Affix from './input-affix.svelte';");
		expect(inputIndexSource).toContain('Affix as InputAffix');
		expect(inputAffixSource).toContain('affix: string;');
		expect(inputAffixSource).toContain('numeric?: boolean;');
		expect(inputAffixSource).toContain('data-slot="input-affix"');
		expect(inputAffixSource).toContain('data-numeric={numeric}');
		expect(inputAffixSource).toContain('ui-input-affix-label');
		expect(selectTriggerSource).toContain("size === 'xs'");
		expect(selectTriggerSource).toContain("'ui-field-size-default'");
		expect(textareaSource).toContain("'ui-textarea-control-md'");
		expect(textareaSource).toContain("'ui-textarea-control-xs'");
		expect(componentTokens).toContain('"button": {');
		expect(componentTokens).toContain('"field": {');
		expect(componentTokens).toContain('"input": {');
		expect(componentTokens).toContain('"select": {');
		expect(componentTokens).toContain('"textarea": {');
		expect(componentTokens).toContain('"{size.control.xs}"');
		expect(componentTokens).toContain('"paddingInlineMd"');
		expect(componentTokens).toContain('"iconMd"');
		expect(componentTokens).toContain('"{radius.sm}"');
		expect(componentTokens).toContain('"dialog": {');
		expect(componentTokens).toContain('"dropdownMenu": {');
		expect(componentTokens).toContain('"sheet": {');
		expect(componentTokens).toContain('"{radius.lg}"');
	});

	it('exports an owned tabs primitive for desktop segmented page switches', () => {
		const source = readSource('src/lib/components/ui/tabs/index.ts');

		expect(source).toContain("import Root from './tabs.svelte';");
		expect(source).toContain("import List from './tabs-list.svelte';");
		expect(source).toContain("import Trigger from './tabs-trigger.svelte';");
		expect(source).toContain('Root,');
		expect(source).toContain('List,');
		expect(source).toContain('Trigger,');
	});

	it('migrates the first dialog and panel surfaces away from helper-class error stacks', () => {
		const intakeDetailsSource = readSource('src/lib/components/intake/details-panel.svelte');
		const intakeContextSource = readSource('src/lib/components/intake/context-panel.svelte');
		const materialDialogSource = readSource('src/lib/components/materials/material-dialog.svelte');
		const labourDialogSource = readSource(
			'src/lib/components/labour-rates/labour-rate-dialog.svelte'
		);
		const equipmentDialogSource = readSource(
			'src/lib/components/equipment-rates/equipment-rate-dialog.svelte'
		);
		const subcontractDialogSource = readSource(
			'src/lib/components/subcontract-rates/subcontract-rate-dialog.svelte'
		);
		const estimateTemplateDialogSource = readSource(
			'src/lib/components/estimate-templates/estimate-template-dialog.svelte'
		);
		const classificationSystemDialogSource = readSource(
			'src/lib/components/classification-systems/classification-system-dialog.svelte'
		);
		const costCodeDialogSource = readSource(
			'src/lib/components/classification-systems/cost-code-dialog.svelte'
		);
		const wbsNodeDialogSource = readSource('src/lib/components/wbs/wbs-node-dialog.svelte');
		const structureTemplateDialogSource = readSource(
			'src/lib/components/wbs/project-structure-template-editor-dialog.svelte'
		);

		for (const source of [
			intakeDetailsSource,
			intakeContextSource,
			materialDialogSource,
			labourDialogSource,
			equipmentDialogSource,
			subcontractDialogSource,
			estimateTemplateDialogSource,
			classificationSystemDialogSource,
			costCodeDialogSource,
			wbsNodeDialogSource,
			structureTemplateDialogSource
		]) {
			expect(source).toContain('FieldShell');
			expect(source).toContain('FieldLabel');
		}

		expect(intakeDetailsSource).toContain('FieldError');
		expect(intakeDetailsSource).toContain('DatePickerField');
		expect(intakeContextSource).toContain('DatePickerField');
		const datePickerSource = readSource('src/lib/components/date-picker-field.svelte');
		expect(datePickerSource).toContain('value = $bindable<string | undefined>()');
		expect(datePickerSource).toContain(
			'ui-select-control ui-field-control-focus ui-field-size-default'
		);
		expect(datePickerSource).toContain('ui-popover-padding-none');
		expect(datePickerSource).toContain('function normaliseCalendarDate');
		expect(datePickerSource).toContain("typeof date === 'string'");
		expect(datePickerSource).toContain(
			'function dateToNativeDate(date: CalendarLike): Date | undefined'
		);
		expect(datePickerSource).toContain("typeof date.toDate === 'function'");
		expect(datePickerSource).toContain('type="single"');
		expect(materialDialogSource).toContain('FieldError');
		expect(labourDialogSource).toContain('FieldError');
		expect(equipmentDialogSource).toContain('FieldError');
		expect(subcontractDialogSource).toContain('FieldError');
		expect(estimateTemplateDialogSource).toContain('FieldError');
		expect(classificationSystemDialogSource).toContain('FieldError');
		expect(costCodeDialogSource).toContain('FieldError');
		expect(wbsNodeDialogSource).toContain('FieldError');
		expect(structureTemplateDialogSource).toContain('FieldError');
		expect(intakeContextSource).not.toContain('field-label px-1');
		const coreAliasHelpRows = [
			[materialDialogSource, 'for="material-aliases"'],
			[labourDialogSource, 'for="labour-rate-aliases"'],
			[equipmentDialogSource, 'for="equipment-rate-aliases"'],
			[subcontractDialogSource, 'for="subcontract-rate-aliases"'],
			[estimateTemplateDialogSource, 'for="estimate-template-aliases"'],
			[classificationSystemDialogSource, 'for="classification-system-aliases"']
		] as const;
		for (const [source, fieldFor] of coreAliasHelpRows) {
			expect(source).toContain('<FieldLabelRow');
			expect(source).toContain(fieldFor);
			expect(source).toContain('tooltip={ALIAS_FIELD_HELP_TEXT}');
		}
		expect(materialDialogSource).not.toContain('<Cluster');
		expect(labourDialogSource).not.toContain('<Cluster gap="sm" align="center">');
		expect(equipmentDialogSource).not.toContain('<Cluster gap="sm" align="center">');
		expect(subcontractDialogSource).not.toContain('<Cluster gap="sm" align="center">');
		expect(estimateTemplateDialogSource).not.toContain('<Cluster gap="sm" align="center">');
		expect(classificationSystemDialogSource).not.toContain('<Cluster gap="sm" align="center">');
		expect(intakeDetailsSource).not.toContain('getFieldErrorMessageClass');
		expect(materialDialogSource).not.toContain('getFieldErrorInputClass');
		expect(labourDialogSource).not.toContain('getFieldErrorInputClass');
		expect(equipmentDialogSource).not.toContain('getFieldErrorInputClass');
		expect(subcontractDialogSource).not.toContain('getFieldErrorInputClass');
		expect(estimateTemplateDialogSource).not.toContain('getFieldErrorInputClass');
		expect(classificationSystemDialogSource).not.toContain('getFieldErrorInputClass');
		expect(costCodeDialogSource).not.toContain('border-destructive');
		expect(wbsNodeDialogSource).not.toContain('getFieldErrorInputClass');
		expect(structureTemplateDialogSource).not.toContain('getFieldErrorInputClass');
		expect(materialDialogSource).not.toContain('class="h-8"');
		expect(labourDialogSource).not.toContain('class="h-8"');
		expect(equipmentDialogSource).not.toContain('class="h-8"');
		expect(subcontractDialogSource).not.toContain('class="h-8"');
		expect(estimateTemplateDialogSource).not.toContain('class="h-8"');
		expect(classificationSystemDialogSource).not.toContain('class="h-8"');
		expect(costCodeDialogSource).not.toContain('class="h-8');
		expect(wbsNodeDialogSource).not.toContain('class="h-8"');
	});

	it('extends the owned field/dialog contract across the remaining core form surfaces', () => {
		const costPresetDialogSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-preset-dialog.svelte'
		);
		const assetEstimateEditorSource = readSource(
			'src/lib/components/assets/asset-estimate-editor.svelte'
		);
		const settingsDialogSource = readSource('src/lib/components/user/settings-dialog.svelte');
		const onboardingWorkspaceSource = readSource(
			'src/lib/components/onboarding/onboarding-workspace.svelte'
		);
		const contactDialogSource = readSource('src/lib/components/contacts/contact-dialog.svelte');

		for (const source of [
			costPresetDialogSource,
			assetEstimateEditorSource,
			settingsDialogSource,
			onboardingWorkspaceSource,
			contactDialogSource
		]) {
			expect(source).toContain('FieldShell');
			expect(source).toContain('FieldLabel');
		}

		expect(costPresetDialogSource).toContain('FieldError');
		expect(assetEstimateEditorSource).toContain('FieldError');
		expect(settingsDialogSource).toContain('FieldError');
		expect(onboardingWorkspaceSource).toContain('FieldError');
		expect(contactDialogSource).toContain('FieldError');
		expect(contactDialogSource).toContain('FieldLabelRow');

		expect(costPresetDialogSource).not.toContain('getFieldErrorInputClass');
		expect(costPresetDialogSource).not.toContain('getFieldErrorMessageClass');
		expect(settingsDialogSource).not.toContain('getFieldErrorInputClass');
		expect(settingsDialogSource).not.toContain('getFieldErrorMessageClass');
		expect(onboardingWorkspaceSource).not.toContain('getFieldErrorInputClass');
		expect(onboardingWorkspaceSource).not.toContain('getFieldErrorMessageClass');
		expect(contactDialogSource).not.toContain('getFieldErrorInputClass');
		expect(contactDialogSource).not.toContain('<Cluster gap="var(--space-1-5)" align="center">');

		const ownedAliasHelpRows = [
			[costPresetDialogSource, 'for="cost-preset-aliases"'],
			[assetEstimateEditorSource, 'for="preset-aliases"'],
			[assetEstimateEditorSource, 'for="template-aliases"']
		] as const;
		for (const [source, fieldFor] of ownedAliasHelpRows) {
			expect(source).toContain('<FieldLabelRow');
			expect(source).toContain(fieldFor);
			expect(source).toContain('tooltip={ALIAS_FIELD_HELP_TEXT}');
		}
		expect(costPresetDialogSource).not.toContain('<Cluster gap="var(--space-1-5)" align="center">');
		expect(assetEstimateEditorSource).not.toContain(
			'<FieldLabel for="preset-aliases">Aliases</FieldLabel>'
		);
		expect(assetEstimateEditorSource).not.toContain(
			'<FieldLabel for="template-aliases">Aliases</FieldLabel>'
		);

		expect(costPresetDialogSource).not.toContain('field-label px-1');
		expect(settingsDialogSource).not.toContain('field-label px-1');
		expect(onboardingWorkspaceSource).not.toContain('field-label px-1');
		expect(contactDialogSource).not.toContain('field-label px-1');

		expect(costPresetDialogSource).not.toContain('class="h-8"');
		expect(onboardingWorkspaceSource).not.toContain('class="h-8"');
		expect(assetEstimateEditorSource).not.toContain(
			"class={presetFieldErrors.name ? 'border-destructive' : ''}"
		);
		expect(assetEstimateEditorSource).not.toContain(
			"class={templateFieldErrors.name ? 'border-destructive' : ''}"
		);
		expect(assetEstimateEditorSource).not.toContain('class="caption text-destructive"');
	});

	it('keeps the next-wave AI panels on owned field and panel primitives', () => {
		const aiSettingsPanelSource = `${readSource('src/lib/components/user/ai-settings-panel.svelte')}\n${readSource('src/lib/components/local-ai-setup-card.svelte')}`;
		const workspaceKnowledgePanelSource = readSource(
			'src/lib/components/user/workspace-knowledge-settings-panel.svelte'
		);

		expect(workspaceKnowledgePanelSource).toContain('Panel');

		expect(aiSettingsPanelSource).toContain('FieldLabelRow');
		expect(aiSettingsPanelSource).toContain('ai-toggle-controls');
		expect(aiSettingsPanelSource).not.toContain('Panel');
		expect(workspaceKnowledgePanelSource).toContain('FieldShell');
		expect(workspaceKnowledgePanelSource).toContain('FieldLabelRow');
		expect(workspaceKnowledgePanelSource).toContain('FieldError');
		expect(workspaceKnowledgePanelSource).toContain('ui-upload-dropzone');
		expect(workspaceKnowledgePanelSource).toContain('ui-file-row');
		expect(workspaceKnowledgePanelSource).not.toContain('ui-file-note-card');
		expect(workspaceKnowledgePanelSource).not.toContain('class="text-foreground"');

		expect(aiSettingsPanelSource).not.toContain('class="h-8"');
		expect(workspaceKnowledgePanelSource).not.toContain('class="h-8"');
		expect(aiSettingsPanelSource).not.toContain('<Label');
		expect(workspaceKnowledgePanelSource).not.toContain('<Label');
		expect(aiSettingsPanelSource).not.toContain('caption text-destructive');
	});

	it('extends the owned field contract into import and estimate editor surfaces', () => {
		const setupImportDialogSource = readSource(
			'src/lib/components/user/setup-import-dialog.svelte'
		);
		const assetEstimateEditorSource = readSource(
			'src/lib/components/assets/asset-estimate-editor.svelte'
		);
		const hydratedAssetEstimateEditorSource = readSource(
			'src/lib/components/assets/hydrated-asset-estimate-editor.svelte'
		);
		const assetEstimateTakeoffItemSource = readSource(
			'src/lib/components/assets/asset-estimate-takeoff-item.svelte'
		);

		expect(setupImportDialogSource).toContain('FieldLabel');
		expect(assetEstimateEditorSource).toContain('FieldShell');
		expect(assetEstimateEditorSource).toContain('FieldLabel');
		expect(assetEstimateEditorSource).toContain('SectionLabel');
		expect(assetEstimateEditorSource).toContain('FormHelpTooltip');
		expect(hydratedAssetEstimateEditorSource).toContain('ui-pane-empty');
		expect(assetEstimateTakeoffItemSource).toContain('FieldShell');
		expect(assetEstimateTakeoffItemSource).toContain('FieldLabel');
		expect(assetEstimateTakeoffItemSource).toContain('FormHelpTooltip');

		expect(assetEstimateEditorSource).not.toContain('<Label');
		expect(assetEstimateTakeoffItemSource).not.toContain('<Label');
		expect(assetEstimateTakeoffItemSource).not.toContain('class="h-8"');
		expect(assetEstimateTakeoffItemSource).not.toContain('class={`h-8');
		expect(setupImportDialogSource).not.toContain('<Label class="field-label');
	});

	it('sweeps the project and quote routes onto the owned field contract', () => {
		const projectRouteSource = readSource('src/routes/project/[id]/+page.svelte');
		const quoteRouteSource = readSource('src/routes/project/[id]/quote/+page.svelte');
		const quotePdfRouteSource = readSource('src/routes/project/[id]/quote/pdf/+page.svelte');
		const wbsRouteSource = readSource('src/routes/project/[id]/wbs/+page.svelte');

		expect(projectRouteSource).toContain('FieldShell');
		expect(projectRouteSource).toContain('FieldLabel');
		expect(projectRouteSource).toContain('SectionLabel');
		expect(projectRouteSource).not.toContain('field-label px-1');
		expect(projectRouteSource).not.toContain('field-label text-foreground');
		expect(projectRouteSource).not.toContain('<Label');

		expect(quoteRouteSource).toContain('FieldShell');
		expect(quoteRouteSource).toContain('FieldLabel');
		expect(quoteRouteSource).toContain('FieldLabelRow');
		expect(quoteRouteSource).toContain('SectionLabel');
		expect(quoteRouteSource).toContain('FieldError');
		expect(quoteRouteSource).toContain('FormHelpTooltip');
		expect(quoteRouteSource).toContain('getFieldInvalidTone');
		expect(quoteRouteSource).toContain('ui-table-row-selectable');
		expect(quoteRouteSource).not.toContain('border-destructive');
		expect(quoteRouteSource).not.toContain('caption text-destructive');
		expect(quoteRouteSource).not.toContain('<Label');

		expect(quotePdfRouteSource).toContain('FormHelpTooltip');
		expect(quotePdfRouteSource).toContain('<h4 class="title-copy">Quote Option</h4>');
		expect(quotePdfRouteSource).toContain('Meta');
		expect(quotePdfRouteSource).toContain('Text');
		expect(quotePdfRouteSource).toContain('ui-pane-header');
		expect(quotePdfRouteSource).toContain('ui-pane-shell');
		expect(quotePdfRouteSource).toContain('ui-pane-empty');
		expect(quotePdfRouteSource).toContain('ui-pane-status');
		expect(quotePdfRouteSource).toContain('paymentTerms: workspaceState.quotePaymentTerms');
		expect(quotePdfRouteSource).toContain(
			'defaultInclusions: workspaceState.quoteDefaultInclusions'
		);
		expect(quotePdfRouteSource).toContain(
			'defaultExclusions: workspaceState.quoteDefaultExclusions'
		);
		expect(quotePdfRouteSource).toContain('defaultTerms: workspaceState.quoteDefaultTerms');
		expect(quotePdfRouteSource).toContain('terms_fallback: pdfDefaults.termsFallback');
		expect(quotePdfRouteSource).toContain('getPdfReadinessBlockers');
		expect(quotePdfRouteSource).toContain(
			'Review AI draft rates and source matches before opening PDF Preview.'
		);
		expect(quotePdfRouteSource).not.toContain('<Label');

		expect(wbsRouteSource).not.toContain('class="h-8"');
	});

	it('extends the owned field and feedback contract into remaining workflow helpers', () => {
		const groupAssetsDialogSource = readSource(
			'src/lib/components/assets/group-assets-dialog.svelte'
		);
		const estimateAiDraftRowSource = readSource(
			'src/lib/components/assets/estimate-ai-draft-row.svelte'
		);

		expect(groupAssetsDialogSource).toContain('FieldShell');
		expect(groupAssetsDialogSource).toContain('FieldLabel');
		expect(groupAssetsDialogSource).not.toContain('<label');
		expect(groupAssetsDialogSource).not.toContain('class="h-8');

		expect(estimateAiDraftRowSource).toContain('ui-ai-empty-prompt');
		expect(estimateAiDraftRowSource).toContain('Badge');
		expect(estimateAiDraftRowSource).not.toContain('ui-pill-panel-sm');
		expect(estimateAiDraftRowSource).toContain('ui-picker-option');
		expect(estimateAiDraftRowSource).toContain('EstimateAiProgressTerminal');
		expect(estimateAiDraftRowSource).not.toContain('Switch');
		expect(estimateAiDraftRowSource).not.toContain('caption text-destructive');
		expect(estimateAiDraftRowSource).not.toContain('surface-panel ui-radius-pill');
		expect(estimateAiDraftRowSource).not.toContain('class="h-8');
	});

	it('keeps raw field-label styling inside owned primitives only', () => {
		const projectRouteSource = readSource('src/routes/project/[id]/+page.svelte');
		const quoteRouteSource = readSource('src/routes/project/[id]/quote/+page.svelte');
		const documentViewerSource = readSource('src/lib/components/assets/document-viewer.svelte');
		const assetEstimateEditorSource = readSource(
			'src/lib/components/assets/asset-estimate-editor.svelte'
		);
		const contactDialogSource = readSource('src/lib/components/contacts/contact-dialog.svelte');
		const settingsDialogSource = readSource('src/lib/components/user/settings-dialog.svelte');
		const workspaceKnowledgePanelSource = readSource(
			'src/lib/components/user/workspace-knowledge-settings-panel.svelte'
		);

		for (const source of [
			projectRouteSource,
			quoteRouteSource,
			documentViewerSource,
			assetEstimateEditorSource,
			contactDialogSource,
			settingsDialogSource,
			workspaceKnowledgePanelSource
		]) {
			expect(source).not.toMatch(/class=["']field-label["']/);
			expect(source).not.toContain('Text as="span" class="field-label"');
			expect(source).not.toContain('<p class="field-label">');
			expect(source).not.toContain('<div class="field-label">');
		}
	});

	it('keeps setup import and shared admin bulk actions on the owned compact contract', () => {
		const setupImportDialogSource = readSource(
			'src/lib/components/user/setup-import-dialog.svelte'
		);
		const estimateTemplatesTableSource = readSource(
			'src/lib/components/estimate-templates/estimate-templates-table.svelte'
		);
		const labourRatesTableSource = readSource(
			'src/lib/components/labour-rates/labour-rate-table.svelte'
		);
		const costPresetsTableSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte'
		);
		const equipmentRatesTableSource = readSource(
			'src/lib/components/equipment-rates/equipment-rate-table.svelte'
		);
		const structureTemplatesTableSource = readSource(
			'src/lib/components/wbs/project-structure-templates-table.svelte'
		);
		const classificationSystemsTableSource = readSource(
			'src/lib/components/classification-systems/classification-systems-table.svelte'
		);
		const materialsTableSource = readSource('src/lib/components/materials/material-table.svelte');

		expect(setupImportDialogSource).toContain('ui-choice-card');
		expect(setupImportDialogSource).toContain('ui-table-surface');
		expect(setupImportDialogSource).not.toContain('caption text-destructive');
		expect(setupImportDialogSource).not.toContain('text-right text-foreground tabular-nums');

		for (const source of [
			estimateTemplatesTableSource,
			labourRatesTableSource,
			costPresetsTableSource,
			equipmentRatesTableSource,
			structureTemplatesTableSource,
			classificationSystemsTableSource,
			materialsTableSource
		]) {
			expect(source).not.toContain('class="muted h-7"');
			expect(source).not.toContain('class="h-7"');
		}
	});

	it('moves AI and revision status surfaces onto owned panel and text primitives', () => {
		const estimateAiDraftRowSource = readSource(
			'src/lib/components/assets/estimate-ai-draft-row.svelte'
		);
		const projectRevisionHistorySource = readSource(
			'src/lib/components/quote/project-revision-history-dialog.svelte'
		);
		const classificationSplitViewSource = readSource(
			'src/lib/components/classification-systems/classification-systems-split-view.svelte'
		);

		for (const source of [estimateAiDraftRowSource, projectRevisionHistorySource]) {
			expect(source).toContain('Text');
			expect(source).toContain('Meta');
		}

		expect(estimateAiDraftRowSource).toContain('Accordion');
		expect(projectRevisionHistorySource).toContain('Eyebrow');
		expect(projectRevisionHistorySource).toContain('ui-revision-history-card');
		expect(projectRevisionHistorySource).toContain('ui-revision-history-list-row');
		expect(projectRevisionHistorySource).toContain('ui-revision-history-summary-grid');
		expect(classificationSplitViewSource).toContain('ui-pane-card');
		expect(classificationSplitViewSource).toContain('ui-pane-card-header');
		expect(estimateAiDraftRowSource).not.toContain('rounded-lg border bg-muted/10');
		expect(estimateAiDraftRowSource).not.toContain('Eyebrow');
		expect(projectRevisionHistorySource).not.toContain(
			'rounded-lg border border-dashed bg-muted/10'
		);
		expect(projectRevisionHistorySource).not.toContain('space-y-1 rounded-lg border bg-muted/10');
	});

	it('keeps assistant and AI task-centre chrome on owned semantic primitives', () => {
		const localAssistantSource = readSource('src/lib/components/ask-kwantflow-sidebar.svelte');
		const aiTaskCentreSource = readSource('src/lib/components/ai-task-centre.svelte');

		expect(localAssistantSource).toContain('Text');
		expect(aiTaskCentreSource).toContain('Text');
		expect(aiTaskCentreSource).toContain('Meta');
		expect(aiTaskCentreSource).toContain('DropdownMenu.Content');
		expect(aiTaskCentreSource).not.toContain('Panel');
		expect(localAssistantSource).toContain('ui-assistant-input');
		expect(localAssistantSource).toContain('ui-assistant-composer');
		expect(localAssistantSource).toContain('ui-derived-preview-card');
		expect(localAssistantSource).toContain('field-copy leading-relaxed');
		expect(aiTaskCentreSource).not.toContain(
			'<p class="shell-label text-foreground">No AI tasks yet.</p>'
		);
		expect(aiTaskCentreSource).not.toContain('<p class="shell-label truncate text-foreground"');
	});
});
