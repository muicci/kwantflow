import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('asset estimate layout', () => {
	it('keeps a draggable resize handle between the estimate form and preview pane', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain(
			'<Resizable.Handle withHandle class={WORKSPACE_RESIZE_HANDLE_CLASS} />'
		);
		expect(source).toContain('class="min-w-0 overflow-hidden"');
	});

	it('lets the estimate form pane fully collapse when the preview is expanded', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain('collapsible');
		expect(source).toContain('collapsedSize={0}');
		expect(source).toContain('{#if !viewerExpanded}');
	});

	it('removes the embedded preview pane when the preview is detached into its own window', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain('assetPreviewState.isDetachedForAsset(asset.id)');
		expect(source).toContain('{#if !previewDetached}');
		expect(source).toContain('<MultiFileViewer');
	});

	it('offers a dedicated detach preview toggle alongside the asset file viewer', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/MultiFileViewer.svelte'),
			'utf8'
		);

		expect(source).toContain('Detach preview');
		expect(source).toContain('Return preview');
		expect(source).toContain(
			'const showFileStrip = $derived(detached ? files.length > 0 : files.length > 1);'
		);
		expect(source).toContain('{#if showFileStrip}');
	});

	it('separates estimate setup from staged takeoff item building', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain('Estimate Setup');
		expect(source).toContain('<EstimateAiDraftRow');
		expect(source).toContain('Takeoff Items');
		expect(source).toContain('<AssetEstimateTakeoffItem');
		expect(source).toContain("import * as Accordion from '$lib/components/ui/accordion/index.js';");
		expect(source).toContain('<Accordion.Root');
		expect(source).toContain('bind:value={activeEstimateSection}');
		expect(source).toContain('<Accordion.Item');
		expect(source).toContain('<Accordion.Trigger');
		expect(source).toContain("type EstimateEditorSection = 'setup' | 'ai' | 'takeoff';");
		expect(source).toContain('let activeEstimateSection = $state<EstimateEditorSection>(');
		expect(source).toContain('let estimateSetupWidth = $state(0);');
		expect(source).toContain(
			"const estimateSetupLayoutMode = $derived(estimateSetupWidth >= 544 ? 'wide' : 'narrow');"
		);
		expect(source).not.toContain(
			'<Resizable.PaneGroup direction="vertical" class="min-h-0 flex-1">'
		);
		expect(source).not.toContain('DEFAULT_ESTIMATE_EDITOR_VERTICAL_LAYOUT');
		expect(source).not.toContain('min-w-96');
	});

	it('seeds presets and templates into one editor-owned source of truth instead of mixing stale route props with refreshed state', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain(
			'costComponentPresetsState.replaceFromSnapshot(costComponentPresets);'
		);
		expect(source).toContain('estimateTemplatesState.replaceFromSnapshot(estimateTemplates);');
		expect(source).toContain(
			'const availableCostComponentPresets = $derived(costComponentPresetsState.list);'
		);
		expect(source).toContain(
			'const availableEstimateTemplates = $derived(estimateTemplatesState.list);'
		);
	});

	it('renders compact one-line section headers with shared expand controls', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);
		const accordionHeaderSource = readFileSync(
			join(process.cwd(), 'src/lib/components/ui/accordion/accordion-header.svelte'),
			'utf8'
		);
		const accordionTriggerSource = readFileSync(
			join(process.cwd(), 'src/lib/components/ui/accordion/accordion-trigger.svelte'),
			'utf8'
		);

		expect(accordionHeaderSource).toContain('ui-accordion-header-row');
		expect(accordionTriggerSource).toContain('ui-accordion-trigger');
		expect(source).toContain(
			'class="flex h-full min-w-0 flex-1 items-center justify-between gap-3"'
		);
		expect(source).toContain(
			'Text as="span" class="shell-label-strong truncate">Estimate Setup</Text>'
		);
		expect(source).toContain('Text as="span" class="shell-label-strong truncate">AI Draft</Text>');
		expect(source).toContain(
			'Text as="span" class="shell-label-strong truncate">Takeoff Items</Text>'
		);
		expect(source).toContain('Reset estimate?');
		expect(source).toContain('Reset estimate');
		expect(source).toContain('onclick={openEstimateResetConfirm}');
		expect(source).toContain("aria-label={isEstimateSectionExpanded('takeoff')");
		expect(source).toContain("aria-label={isEstimateSectionExpanded('setup')");
		expect(source).toContain("aria-label={isEstimateSectionExpanded('ai')");
		expect(source).toContain('class="ui-accordion-trigger-icon"');
		expect(source).toContain('size="sm"');
		expect(source).toContain("activeEstimateSection = 'takeoff';");
		expect(source).not.toContain(
			"Classification: {collapsedEstimateMetadata[0]?.value ?? 'Unclassified'}"
		);
		expect(source).not.toContain("Structure: {collapsedEstimateMetadata[1]?.value ?? 'None'}");
	});

	it('renders the collapsed takeoff item summary as a scope-first inline row', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-takeoff-item.svelte'),
			'utf8'
		);

		expect(source).toContain("title={item.name.trim() || 'Scope item'}");
		expect(source).toContain("{item.name.trim() || 'Scope item'}");
		expect(source).not.toMatch(
			/<span class="caption inline-flex h-7 items-center rounded-full border px-2\.5">\s*\{item\.name\.trim\(\) \|\| 'Scope item'\}\s*<\/span>/
		);
		expect(source).not.toContain('<MetadataSummaryList items={collapsedItemMetadata} />');
		expect(source).toContain('Cost Code: {selectedCostCodeLabel(item.cost_code_id)}');
		expect(source).toContain('Structure: {selectedWbsLabel(item.wbs_node_id)}');
		expect(source).toContain('Preset: {item.applied_preset_name}');
		expect(source).toContain('AI Confidence: {formatConfidence(itemAiConfidence(item)?.overall)}');
		expect(source).toContain('Review items: {itemAiQuestions(item).length}');
		expect(source).toContain("itemSetupLayoutMode === 'wide'");
		expect(source).toContain('class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pt-3"');
	});

	it('renders the collapsed scope summary as a single truncated line instead of a chip', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).not.toMatch(
			/<span class="caption inline-flex h-7 items-center rounded-full border px-2\.5">\s*\{estimate\.scope_summary\.trim\(\) \|\| 'No scope summary'\}\s*<\/span>/
		);
		expect(source).not.toContain('collapsedScopeSummary');
	});

	it('renders the collapsed takeoff item name as a single truncated line instead of a chip', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-takeoff-item.svelte'),
			'utf8'
		);

		expect(source).toContain(
			'<div title={item.name.trim() || \'Scope item\'} class="min-w-0 flex-1">'
		);
		expect(source).toContain('<Text class="truncate">{item.name.trim() || \'Scope item\'}</Text>');
		expect(source).toContain("{item.name.trim() || 'Scope item'}");
		expect(source).not.toMatch(
			/<span class="caption inline-flex h-7 items-center rounded-full border px-2\.5">\s*\{item\.name\.trim\(\) \|\| 'Scope item'\}\s*<\/span>/
		);
	});

	it('delegates takeoff item rendering to a focused child component', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-takeoff-item.svelte'),
			'utf8'
		);
		const themeSource = readFileSync(join(process.cwd(), 'src/lib/design/theme.css'), 'utf8');

		expect(source).toContain(
			"import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';"
		);
		expect(source).not.toContain(
			"import SetupSectionHeader from '$lib/components/assets/setup-section-header.svelte';"
		);
		expect(source).toContain('<DropdownMenu.Root>');
		expect(source).toContain('Add cost row');
		expect(source).toContain('Item details');
		expect(source).toContain('Item Total');
		expect(source).toContain('showAiReviewSession');
		expect(source).toContain('Edit item');
		expect(source).toContain('Hide setup');
		expect(source).toContain('toggleTakeoffSetup');
		expect(source).toContain("{item.name.trim() || 'Scope item'}");
		expect(source).toContain('class={`ui-section-surface min-w-0 overflow-hidden');
		expect(themeSource).toContain('.ui-section-surface {');
		expect(themeSource).toContain('border-radius: var(--radius-md);');
		expect(source).not.toContain('Add Material Catalogue');
		expect(source).not.toContain('Add Labour Rate');
		expect(source).not.toContain('Add Equipment Rate');
		expect(source).not.toContain('Add Subcontract Rate');
	});

	it('uses explicit empty-source guidance in the takeoff builder', () => {
		const editorSource = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);
		const itemSource = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-takeoff-item.svelte'),
			'utf8'
		);

		expect(editorSource).toContain('No estimate templates found');
		expect(editorSource).toContain('ui-picker-empty');
		expect(editorSource).toContain('ui-picker-option');
		expect(itemSource).toContain('No material catalogue items yet');
		expect(itemSource).toContain('No labour rates yet');
		expect(itemSource).toContain('No equipment rates yet');
		expect(itemSource).toContain('No cost presets yet');
		expect(itemSource).toContain('ui-picker-empty');
		expect(itemSource).toContain('ui-picker-option');
		expect(itemSource).toMatch(
			/Add a catalogue item, apply a preset, or create a manual cost\s+row\./
		);
	});

	it('keeps template visibility and confirm workflows explicit inside the editor', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain("const log = createLogger('assetEstimateEditor');");
		expect(source).toContain('function openTemplatePickerDialog()');
		expect(source).toContain('Apply Estimate Template');
		expect(source).toContain('Search by name, code, or alias to apply a saved estimate template.');
		expect(source).toContain('function confirmPendingTemplateApply(): void {');
		expect(source).toContain("cancelPendingTemplateApply('cancelled')");
		expect(source).toContain('function confirmPendingPresetApply(): void {');
		expect(source).toContain("cancelPendingPresetApply('cancelled')");
		expect(source).toContain('function handleAiReplaceOpenChange(open: boolean): void {');
		expect(source).toContain("cancelPendingAiReplace('cancelled')");
	});

	it('uses searchable classification and structure-root pickers instead of long inline selects', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(source).toContain('<Dialog.FormFrame');
		expect(source).toContain('Choose Classification');
		expect(source).toContain(
			'Search by name, code, type, or alias to set the estimate classification.'
		);
		expect(source).toContain('ui-picker-surface');
		expect(source).toContain('classificationPickerSearch');
		expect(source).toContain('openClassificationPickerDialog');
		expect(source).toContain('No classifications yet');
		expect(source).toContain('size="sm"');
		expect(source).toContain(
			'class="ui-field-trigger-button w-full min-w-0 justify-between gap-2"'
		);
		expect(source).toContain('Choose Structure Root');
		expect(source).toContain(
			'Search by name, code, or path to set the starting structure node for this estimate.'
		);
		expect(source).toContain('structureRootPickerSearch');
		expect(source).toContain('openStructureRootPickerDialog');
		expect(source).toContain('No structure roots yet');
		expect(source).toContain("Aliases: ${option.aliases.join(', ')}");
		expect(source).not.toContain('class="ui-dialog-size-lg"');
		expect(source).not.toContain(
			'<Select.Trigger size="sm" class="h-8 w-full">\n\t\t\t\t\t\t\t\t\t\t{selectedClassificationName()}'
		);
		expect(source).not.toContain(
			'<Select.Trigger size="sm" class="h-8 w-full">\n\t\t\t\t\t\t\t\t\t\t{selectedWbsRootName()}'
		);
	});

	it('remounts the estimate editor when the active asset changes instead of resetting it in an effect', () => {
		const routeSource = readFileSync(
			join(process.cwd(), 'src/routes/project/[id]/asset/[assetId]/+page.svelte'),
			'utf8'
		);
		const loaderSource = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/hydrated-asset-estimate-editor.svelte'),
			'utf8'
		);

		expect(routeSource).toContain('{#key asset.id}');
		expect(routeSource).toContain('<HydratedAssetEstimateEditor');
		expect(loaderSource).toContain('onMount(() => {');
		expect(loaderSource).toContain('void engine.hydrateEstimate(asset.id).then(() => {');
	});
});
