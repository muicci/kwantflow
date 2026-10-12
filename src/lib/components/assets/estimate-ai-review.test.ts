import { describe, expect, it } from 'vitest';
import type { AiIssue, CostComponent, Estimate, TakeoffItem } from '$lib/types/index.js';
import { formatDisplayedAiIssueMessage, resolveDisplayedAiIssues } from './estimate-ai-review.js';

function createComponent(overrides: Partial<CostComponent> = {}): CostComponent {
	return {
		id: 'component-1',
		takeoff_item_id: 'item-1',
		category: 'material',
		source_type: 'material_catalog',
		source_id: 'source-1',
		name: 'Structural Steel Material',
		description: '',
		quantity: 1,
		unit: 'lot',
		unit_rate: 6_200,
		formula: {},
		metadata: {},
		sort_order: 0,
		...overrides
	};
}

function createTakeoffItem(overrides: Partial<TakeoffItem> = {}): TakeoffItem {
	return {
		id: 'item-1',
		estimate_asset_id: 'asset-1',
		parent_id: null,
		wbs_node_id: null,
		cost_code_id: null,
		applied_preset_id: null,
		applied_preset_name: null,
		name: 'Structural Steel Canopy',
		description: '',
		quantity: 1,
		unit: 'ea',
		properties: {},
		sort_order: 0,
		cost_components: [],
		...overrides
	};
}

function createEstimate(components: CostComponent[]): Estimate {
	return {
		asset_id: 'asset-1',
		scope_summary: 'Canopy',
		notes: '',
		classification_system_id: null,
		wbs_root_node_id: null,
		applied_template_id: null,
		applied_template_name: null,
		takeoff_items: [
			createTakeoffItem({
				cost_components: components
			})
		]
	};
}

function createIssue(overrides: Partial<AiIssue> & Pick<AiIssue, 'code' | 'message'>): AiIssue {
	return {
		severity: 'warning',
		fileId: null,
		fileName: null,
		...overrides
	};
}

describe('resolveDisplayedAiIssues', () => {
	it('drops stale rate-review issues after the current estimate fixes the rate', () => {
		const estimate = createEstimate([createComponent()]);
		const issues = [
			createIssue({
				code: 'missing_component_rate',
				message: 'Structural Steel Material needs a rate review.'
			}),
			createIssue({
				code: 'semantic_source_match',
				message:
					'Structural Steel Material on Structural Steel Canopy was linked to the highest-scoring workspace source and should be reviewed before final save.',
				severity: 'info'
			})
		];

		expect(resolveDisplayedAiIssues({ status: 'applied', issues, estimate })).toEqual([issues[1]]);
	});

	it('keeps source and rate issues while the current estimate is still unresolved', () => {
		const estimate = createEstimate([
			createComponent({
				source_id: null,
				unit_rate: 0
			})
		]);
		const issues = [
			createIssue({
				code: 'invalid_material_catalog_source',
				message:
					'The linked source for Structural Steel Material on Structural Steel Canopy is not available locally.'
			}),
			createIssue({
				code: 'missing_component_rate',
				message: 'Structural Steel Material needs a rate review.'
			})
		];

		expect(resolveDisplayedAiIssues({ status: 'applied', issues, estimate })).toEqual(issues);
	});

	it('does not rewrite issues for non-applied run states', () => {
		const estimate = createEstimate([createComponent()]);
		const issues = [
			createIssue({
				code: 'missing_component_rate',
				message: 'Structural Steel Material needs a rate review.'
			})
		];

		expect(resolveDisplayedAiIssues({ status: 'drafting', issues, estimate })).toEqual(issues);
	});
});

describe('formatDisplayedAiIssueMessage', () => {
	it('drops the commercially usable suffix from rate-review messages', () => {
		expect(
			formatDisplayedAiIssueMessage(
				'1 cost row still needs quantity or rate review before this estimate is commercially usable.'
			)
		).toBe('1 cost row still needs quantity or rate review.');
	});

	it('keeps component-level rate-review wording compact', () => {
		expect(
			formatDisplayedAiIssueMessage(
				'Structural Steel Material needs a rate review before this estimate is commercially usable.'
			)
		).toBe('Structural Steel Material needs a rate review.');
	});
});
