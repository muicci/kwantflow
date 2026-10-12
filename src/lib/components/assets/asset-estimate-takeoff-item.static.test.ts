import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(
	process.cwd(),
	'src/lib/components/assets/asset-estimate-takeoff-item.svelte'
);

describe('asset estimate takeoff item table', () => {
	it('keeps a compact unnamed actions column and tighter name/rate spacing in the cost-row table', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('function tableWidthClass(layoutMode');
		expect(source).toContain("return layoutMode === 'wide' ? 'min-w-xl' : 'min-w-lg';");
		expect(source).toContain('function tableCategoryClass(layoutMode');
		expect(source).toContain('function tableNameClass(layoutMode');
		expect(source).toContain('function tableQtyClass(layoutMode');
		expect(source).toContain('function tableRateClass(layoutMode');
		expect(source).toContain('function tableTotalClass(layoutMode');
		expect(source).toContain('function tableActionClass(layoutMode');
		expect(source).toContain('min-w-24');
		expect(source).toContain("return layoutMode === 'wide' ? 'w-24 px-0' : 'w-20 px-0';");
		expect(source).toContain("return layoutMode === 'wide' ? 'w-20 ps-0 pe-2' : 'w-18 ps-0 pe-1';");
		expect(source).toContain("return layoutMode === 'wide' ? 'w-24 ps-2 pe-0' : 'w-20 ps-1 pe-0';");
		expect(source).toContain(
			"getNumericInputValue(component.id, 'unit_rate', component.unit_rate)"
		);
		expect(source).toContain("onfocus={() => beginNumericInputEdit(component.id, 'unit_rate')}");
		expect(source).toContain('let itemSetupWidth = $state(0);');
		expect(source).toContain(
			"const itemSetupLayoutMode = $derived.by<'wide' | 'compact' | 'narrow'>(() => {"
		);
		expect(source).toContain("if (itemSetupWidth >= 672) return 'wide';");
		expect(source).toContain("if (itemSetupWidth >= 512) return 'compact';");
		expect(source).toContain('grid-cols-[minmax(0,1.45fr)_minmax(0,0.7fr)_minmax(0,0.85fr)]');
		expect(source).toContain('grid-cols-[minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,0.8fr)]');
		expect(source).toContain('class="flex flex-wrap items-center justify-between gap-2"');
		expect(source).toContain('<Button {...props} size="sm" class="gap-2" {disabled}>');
		expect(source).toContain('class={tableWidthClass(itemSetupLayoutMode)}');
		expect(source).not.toContain('<TableHeaderLabel text="Actions" align="right" />');
	});

	it('keeps detailed AI review out of the editable row cells and in the secondary review panel', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('Component review');
		expect(source).toContain('Set rate manually');
		expect(source).toContain('Review actions');
		expect(source).toContain('Check uploaded file');
		expect(source).toContain('componentReviewEntries(item).length > 0');
		expect(source).toContain('componentReviewMeta(component)');
		expect(source).toContain('<FormHelpTooltip');
		expect(source).toContain('distinctComponentEvidence(item, component).length > 0');
		expect(source).toContain(
			'AI found a likely workspace match, but the rate still needs review before save.'
		);
		expect(source).toContain(
			'class={`ui-radius-pill size-1.5 shrink-0 ${reviewDotClass(componentReviewTone(component))}`}'
		);
		expect(source).toContain('itemNameAckKey');
		expect(source).toContain('componentNameAckKey');
		expect(source).not.toContain('Mapping: {componentAiMappingStatus(component)}');
		expect(source).not.toContain('class="caption inline-flex h-6 items-center rounded-full border');
		expect(source).not.toContain('Questions for you');
	});

	it('lets users relink an existing unresolved row from workspace data without adding a duplicate row', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain(
			'function componentCanLinkFromWorkspace(component: CostComponent): boolean'
		);
		expect(source).toContain(
			"import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';"
		);
		expect(source).toContain('type WorkspaceLinkIntent = {');
		expect(source).toContain(
			'function workspaceLinkCategoryLabel(category: WorkspaceLinkCategory): string'
		);
		expect(source).toContain(
			'function workspaceLinkOptions(category: WorkspaceLinkCategory): WorkspaceLinkOption[]'
		);
		expect(source).toContain('function openWorkspaceLinkDialog(intent: WorkspaceLinkIntent): void');
		expect(source).toMatch(/workspaceLinkSearch\s*=\s*'';/);
		expect(source).toContain('function selectWorkspaceLinkOption(optionId: string): Promise<void>');
		expect(source).toContain('filterPickerOptions,');
		expect(source).toContain(
			'filterPickerOptions(availableWorkspaceLinkOptions, workspaceLinkSearch)'
		);
		expect(source).toContain('Open cost row actions');
		expect(source).toContain('Link from workspace');
		expect(source).toContain('Duplicate cost row');
		expect(source).toContain('Delete cost row');
		expect(source).toContain('Search Material Catalogue');
		expect(source).toContain('Search Labour Rates');
		expect(source).toContain('Search Equipment Rates');
		expect(source).toContain('Search Subcontract Rates');
		expect(source).toContain('Search Cost Presets');
		expect(source).toContain("'Cost Codes'");
		expect(source).toContain("'Project Structure'");
		expect(source).toContain('querySeed: item.name');
		expect(source).toContain('querySeed: component.name');
		expect(source).toContain('Search name, code, or alias');
		expect(source).toContain(
			'Type estimator shorthand, supplier wording, or alternate record names.'
		);
		expect(source).toContain('workspaceLinkAllowsClear');
		expect(source).toContain('workspaceLinkClearLabel');
		expect(source).toContain('workspaceLinkClearDescription');
		expect(source).toContain('No cost code');
		expect(source).toContain('No structure node');
		expect(source).toContain('autofocus');
		expect(source).toContain("FormHelpTooltip content={`Aliases: ${option.aliases.join(', ')}`}");
	});

	it('uses the shared searchable workspace picker for takeoff cost code and structure fields', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("mode: 'set_item_field'");
		expect(source).toContain("category: 'cost_code'");
		expect(source).toContain("category: 'structure'");
		expect(source).toContain('selectedCostCodeLabel(item.cost_code_id)');
		expect(source).toContain('selectedWbsLabel(item.wbs_node_id)');
		expect(source).toContain(
			'class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"'
		);
		expect(source).toContain('Search by code, name, or description to set the takeoff cost code.');
		expect(source).toContain(
			'Search by name, code, or structure type to set the takeoff structure node.'
		);
		expect(source).not.toContain("updateTakeoffItemField(item.id, 'cost_code_id', value || null)");
		expect(source).not.toContain("updateTakeoffItemField(item.id, 'wbs_node_id', value || null)");
	});
});
