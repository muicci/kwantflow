import { describe, expect, it } from 'vitest';
import {
	clampQuoteOptionMarkupPercentage,
	costComponentUnitCost,
	estimateHasQuoteContent,
	estimateTotalCost,
	estimateTotalPrice,
	takeoffItemTotal
} from './quote.svelte';
import type { Estimate } from '$lib/types/index.js';

describe('estimate calculations', () => {
	it('prices all takeoff quantities and preserves category overrides including zero and discounts', () => {
		const estimate: Estimate = {
			asset_id: 'asset-1',
			scope_summary: 'Ten plates with two hours of finishing',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			takeoff_items: (
				[
					{ id: 'plate', quantity: 10, category: 'material', rate: 50 },
					{ id: 'finish', quantity: 2, category: 'labour', rate: 50 }
				] as const
			).map(({ id, quantity, category, rate }) => ({
				id,
				estimate_asset_id: 'asset-1',
				parent_id: null,
				wbs_node_id: null,
				cost_code_id: null,
				name: id,
				description: '',
				quantity,
				unit: 'ea',
				properties: {},
				sort_order: 0,
				cost_components: [
					{
						id: `${id}-cost`,
						takeoff_item_id: id,
						category,
						source_type: 'manual',
						source_id: null,
						name: id,
						description: '',
						quantity: 1,
						unit: 'ea',
						unit_rate: rate,
						formula: {},
						metadata: {}
					}
				]
			}))
		};
		expect(estimateTotalCost(estimate)).toBe(600);
		expect(estimateTotalPrice(estimate, 0, null, null, null, null)).toBe(600);
		expect(estimateTotalPrice(estimate, 10, 20, null, null, null)).toBe(710);
		expect(estimateTotalPrice(estimate, 10, 0, null, null, null)).toBe(610);
		expect(estimateTotalPrice(estimate, -100, null, null, null, null)).toBe(0);
	});

	it('calculates a component unit cost from quantity and unit rate', () => {
		expect(
			costComponentUnitCost({
				id: 'comp-1',
				takeoff_item_id: 'item-1',
				category: 'material',
				source_type: 'manual',
				source_id: null,
				name: 'Steel Plate',
				description: '',
				quantity: 3.5,
				unit: 'kg',
				unit_rate: 4.25,
				formula: {},
				metadata: {}
			})
		).toBe(14.875);
	});

	it('calculates a takeoff item total as item quantity times all component unit costs', () => {
		expect(
			takeoffItemTotal({
				id: 'item-1',
				estimate_asset_id: 'asset-1',
				parent_id: null,
				wbs_node_id: null,
				cost_code_id: null,
				name: 'Base Plate',
				description: '',
				quantity: 2,
				unit: 'ea',
				properties: {},
				sort_order: 0,
				cost_components: [
					{
						id: 'comp-1',
						takeoff_item_id: 'item-1',
						category: 'material',
						source_type: 'manual',
						source_id: null,
						name: 'Steel Plate',
						description: '',
						quantity: 3.5,
						unit: 'kg',
						unit_rate: 4.25,
						formula: {},
						metadata: {}
					},
					{
						id: 'comp-2',
						takeoff_item_id: 'item-1',
						category: 'labour',
						source_type: 'manual',
						source_id: null,
						name: 'Laser Cut',
						description: '',
						quantity: 0.5,
						unit: 'hr',
						unit_rate: 120,
						formula: {},
						metadata: {}
					}
				]
			})
		).toBe(149.75);
	});

	it('rolls an estimate total up from all takeoff items', () => {
		expect(
			estimateTotalCost({
				asset_id: 'asset-1',
				scope_summary: 'Bracket bundle',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: [
					{
						id: 'item-1',
						estimate_asset_id: 'asset-1',
						parent_id: null,
						wbs_node_id: null,
						cost_code_id: null,
						name: 'Base Plate',
						description: '',
						quantity: 2,
						unit: 'ea',
						properties: {},
						sort_order: 0,
						cost_components: [
							{
								id: 'comp-1',
								takeoff_item_id: 'item-1',
								category: 'material',
								source_type: 'manual',
								source_id: null,
								name: 'Steel Plate',
								description: '',
								quantity: 3.5,
								unit: 'kg',
								unit_rate: 4.25,
								formula: {},
								metadata: {}
							},
							{
								id: 'comp-2',
								takeoff_item_id: 'item-1',
								category: 'labour',
								source_type: 'manual',
								source_id: null,
								name: 'Laser Cut',
								description: '',
								quantity: 0.5,
								unit: 'hr',
								unit_rate: 120,
								formula: {},
								metadata: {}
							}
						]
					},
					{
						id: 'item-2',
						estimate_asset_id: 'asset-1',
						parent_id: null,
						wbs_node_id: null,
						cost_code_id: null,
						name: 'Powdercoat',
						description: '',
						quantity: 1,
						unit: 'lot',
						properties: {},
						sort_order: 1,
						cost_components: [
							{
								id: 'comp-3',
								takeoff_item_id: 'item-2',
								category: 'subcontract',
								source_type: 'manual',
								source_id: null,
								name: 'Coating Vendor',
								description: '',
								quantity: 1,
								unit: 'lot',
								unit_rate: 45,
								formula: {},
								metadata: {}
							}
						]
					}
				]
			})
		).toBe(194.75);
	});
});

describe('estimateHasQuoteContent', () => {
	it('returns false for the blank default estimate state', () => {
		expect(
			estimateHasQuoteContent({
				asset_id: 'asset-1',
				scope_summary: '',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: []
			})
		).toBe(false);
	});

	it('returns true when estimate summary fields are filled', () => {
		expect(
			estimateHasQuoteContent({
				asset_id: 'asset-1',
				scope_summary: 'Bracket assembly',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: []
			})
		).toBe(true);
	});

	it('returns true when takeoff items exist even if header fields are blank', () => {
		expect(
			estimateHasQuoteContent({
				asset_id: 'asset-1',
				scope_summary: '',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: [
					{
						id: 'item-1',
						estimate_asset_id: 'asset-1',
						parent_id: null,
						wbs_node_id: null,
						cost_code_id: null,
						name: 'Laser Cut Scope',
						description: '',
						quantity: 1,
						unit: 'ea',
						properties: {},
						sort_order: 0,
						cost_components: []
					}
				]
			})
		).toBe(true);
	});
});

describe('clampQuoteOptionMarkupPercentage', () => {
	it('returns 0 for non-finite numbers', () => {
		expect(clampQuoteOptionMarkupPercentage(NaN)).toBe(0);
		expect(clampQuoteOptionMarkupPercentage(Infinity)).toBe(0);
		expect(clampQuoteOptionMarkupPercentage(-Infinity)).toBe(0);
	});

	it('clamps values below -100 to exactly -100', () => {
		expect(clampQuoteOptionMarkupPercentage(-101)).toBe(-100);
		expect(clampQuoteOptionMarkupPercentage(-200)).toBe(-100);
		expect(clampQuoteOptionMarkupPercentage(-100.1)).toBe(-100);
	});

	it('allows values -100 and above to pass through unchanged', () => {
		expect(clampQuoteOptionMarkupPercentage(-100)).toBe(-100);
		expect(clampQuoteOptionMarkupPercentage(-99)).toBe(-99);
		expect(clampQuoteOptionMarkupPercentage(0)).toBe(0);
		expect(clampQuoteOptionMarkupPercentage(50)).toBe(50);
		expect(clampQuoteOptionMarkupPercentage(1000)).toBe(1000);
		expect(clampQuoteOptionMarkupPercentage(99.9)).toBe(99.9);
	});
});
