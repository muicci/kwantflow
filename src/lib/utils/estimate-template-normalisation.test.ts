import { describe, expect, it } from 'vitest';
import { EstimateTemplateRowSchema } from '$lib/schemas/index.js';
import type { CostComponentPreset, Estimate } from '$lib/types/index.js';
import {
	normaliseEstimateTemplatePayload,
	normaliseEstimateTemplatePayloadLike,
	normaliseReusablePresetComponents
} from './estimate-template-normalisation.js';

describe('normaliseEstimateTemplatePayload', () => {
	it('fills missing sort orders for takeoff items and cost components', () => {
		const estimate: Estimate = {
			asset_id: 'asset-1',
			scope_summary: 'Bracket estimate',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: 'wbs-root-1',
			takeoff_items: [
				{
					id: 'item-1',
					estimate_asset_id: 'asset-1',
					parent_id: null,
					wbs_node_id: 'wbs-node-1',
					cost_code_id: null,
					name: 'Bracket',
					description: '',
					quantity: 12,
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
							name: 'Steel',
							description: '',
							quantity: 14,
							unit: 'kg',
							unit_rate: 2.85,
							formula: {},
							metadata: {}
						},
						{
							id: 'comp-2',
							takeoff_item_id: 'item-1',
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Cutting',
							description: '',
							quantity: 0.75,
							unit: 'hr',
							unit_rate: 110,
							formula: {},
							metadata: {}
						}
					]
				}
			]
		};

		const normalised = normaliseEstimateTemplatePayload(estimate);

		expect(normalised.takeoff_items[0]?.sort_order).toBe(0);
		expect(normalised.takeoff_items[0]?.cost_components[0]?.sort_order).toBe(0);
		expect(normalised.takeoff_items[0]?.cost_components[1]?.sort_order).toBe(1);
		expect(normalised.wbs_root_node_id).toBeNull();
		expect(normalised.takeoff_items[0]?.wbs_node_id).toBeNull();
	});

	it('preserves existing explicit sort orders', () => {
		const estimate: Estimate = {
			asset_id: 'asset-1',
			scope_summary: 'Room repair',
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
					name: 'Repair scope',
					description: '',
					quantity: 1,
					unit: 'lot',
					properties: {},
					sort_order: 5,
					cost_components: [
						{
							id: 'comp-1',
							takeoff_item_id: 'item-1',
							category: 'equipment',
							source_type: 'equipment_rate_card',
							source_id: 'equip-1',
							name: 'Dehumidifier',
							description: '',
							quantity: 3,
							unit: 'day',
							unit_rate: 95,
							formula: {},
							metadata: {},
							sort_order: 9
						}
					]
				}
			]
		};

		const normalised = normaliseEstimateTemplatePayload(estimate);

		expect(normalised.takeoff_items[0]?.sort_order).toBe(5);
		expect(normalised.takeoff_items[0]?.cost_components[0]?.sort_order).toBe(9);
	});

	it('normalises legacy template payloads with missing nested sort orders', () => {
		const parsed = EstimateTemplateRowSchema.parse({
			id: 'template-1',
			workspace_id: 'local-workspace',
			code: 'FAB-BRACKET',
			name: 'Fabricated Bracket Template',
			description: '',
			aliases_json: '[]',
			estimate_json: JSON.stringify({
				scope_summary: 'Bracket estimate',
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
						name: 'Bracket',
						description: '',
						quantity: 1,
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
								name: 'Steel',
								description: '',
								quantity: 10,
								unit: 'kg',
								unit_rate: 2.85,
								formula: {},
								metadata: {}
							}
						]
					}
				]
			}),
			is_active: 1,
			created_at: '2026-03-08T00:00:00.000Z',
			updated_at: '2026-03-08T00:00:00.000Z'
		});

		expect(parsed.estimate_json.takeoff_items[0]?.cost_components[0]?.sort_order).toBe(0);
	});

	it('normalises unknown payload-like objects defensively', () => {
		const normalised = normaliseEstimateTemplatePayloadLike({
			wbs_root_node_id: 'wbs-root-legacy',
			takeoff_items: [
				{
					wbs_node_id: 'wbs-node-legacy',
					properties: {
						ai_confidence: { overall: 0.2 },
						ai_open_questions: ['Confirm quantity'],
						note: 'keep me'
					},
					sort_order: undefined,
					cost_components: [
						{
							sort_order: undefined,
							metadata: {
								ai_mapping_status: 'unresolved',
								ai_evidence_refs: [{ summary: 'legacy' }],
								keep: true
							}
						},
						{}
					]
				}
			]
		}) as {
			wbs_root_node_id: null;
			takeoff_items: Array<{
				wbs_node_id: null;
				properties: Record<string, unknown>;
				sort_order: number;
				cost_components: Array<{ metadata?: Record<string, unknown>; sort_order: number }>;
			}>;
		};

		expect(normalised.takeoff_items[0]?.sort_order).toBe(0);
		expect(normalised.takeoff_items[0]?.cost_components[0]?.sort_order).toBe(0);
		expect(normalised.takeoff_items[0]?.cost_components[1]?.sort_order).toBe(1);
		expect(normalised.wbs_root_node_id).toBeNull();
		expect(normalised.takeoff_items[0]?.wbs_node_id).toBeNull();
		expect(normalised.takeoff_items[0]?.properties).toEqual({ note: 'keep me' });
		expect(normalised.takeoff_items[0]?.cost_components[0]?.metadata).toEqual({ keep: true });
	});

	it('strips reusable AI provenance when saving estimate templates', () => {
		const estimate: Estimate = {
			...{
				asset_id: 'asset-1',
				scope_summary: 'Canopy estimate',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: 'wbs-root-1',
				takeoff_items: [
					{
						id: 'item-1',
						estimate_asset_id: 'asset-1',
						parent_id: null,
						wbs_node_id: 'wbs-node-1',
						cost_code_id: null,
						applied_preset_id: null,
						applied_preset_name: null,
						name: 'Canopy',
						description: '',
						quantity: 1,
						unit: 'ea',
						properties: {
							ai_confidence: { overall: 0.3 },
							ai_open_questions: ['Confirm size'],
							keep: 'yes'
						},
						sort_order: 0,
						cost_components: [
							{
								id: 'comp-1',
								takeoff_item_id: 'item-1',
								category: 'material',
								source_type: 'manual',
								source_id: null,
								name: 'Steel',
								description: '',
								quantity: 1,
								unit: 'kg',
								unit_rate: 0,
								formula: {},
								metadata: {
									ai_mapping_status: 'unresolved',
									ai_evidence_refs: [{ summary: 'from AI' }],
									ai_confidence: { overall: 0.1 },
									keep: 'metadata'
								},
								sort_order: 0
							}
						]
					}
				]
			}
		};

		const normalised = normaliseEstimateTemplatePayload(estimate);

		expect(normalised.takeoff_items[0]?.properties).toEqual({ keep: 'yes' });
		expect(normalised.takeoff_items[0]?.cost_components[0]?.metadata).toEqual({
			keep: 'metadata'
		});
	});
});

describe('normaliseReusablePresetComponents', () => {
	it('strips AI provenance from reusable preset components', () => {
		const components: CostComponentPreset['components'] = [
			{
				category: 'labour',
				source_type: 'manual',
				source_id: null,
				name: 'Install labour',
				description: '',
				quantity: 2,
				unit: 'hr',
				unit_rate: 95,
				formula: {},
				metadata: {
					ai_confidence: { overall: 0.7 },
					ai_mapping_status: 'linked',
					ai_evidence_refs: [{ summary: 'legacy' }],
					keep: true
				},
				sort_order: 0
			}
		];

		expect(normaliseReusablePresetComponents(components)[0]?.metadata).toEqual({ keep: true });
	});
});
