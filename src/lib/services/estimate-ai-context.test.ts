import { describe, expect, it } from 'vitest';

import {
	buildAiEstimateContextSnapshot,
	buildDraftMatchingFromReconciledEstimate,
	buildEstimateMappingReview,
	ESTIMATE_MAPPING_CLEAR_VALUE,
	normaliseAiTableSnapshot
} from './estimate-ai-context.js';
import type { AiDraftEstimate, Estimate } from '$lib/types/index.js';

function createEstimate(overrides: Partial<Estimate> = {}): Estimate {
	return {
		asset_id: 'asset-1',
		scope_summary: 'Existing estimate',
		notes: '',
		classification_system_id: null,
		wbs_root_node_id: null,
		applied_template_id: null,
		applied_template_name: null,
		takeoff_items: [],
		...overrides
	};
}

function createTableSnapshot() {
	return {
		classificationSystems: [
			{ id: 'class-steel', code: 'STEEL', name: 'Steel codes', type: 'custom', is_default: true }
		],
		costCodes: [
			{
				id: 'cost-steel',
				classification_system_id: 'class-steel',
				parent_id: null,
				code: '100',
				name: 'Fabrication',
				description: '',
				is_active: true
			}
		],
		wbsNodes: [{ id: 'wbs-root', parent_id: null, code: 'A', name: 'Area A', type: 'zone' }],
		materialCatalogItems: [
			{
				id: 'material-1',
				code: 'PL-6',
				name: 'Plate 6 mm',
				aliases: ['6mm plate', 'plate six'],
				category: 'Plate',
				specification: 'AS/NZS',
				unit: 'ea',
				default_rate: 25,
				metadata: {},
				is_active: true
			}
		],
		labourRateCards: [
			{
				id: 'labour-1',
				code: 'FAB',
				name: 'Fabrication labour',
				aliases: ['shop fab', 'fabrication crew'],
				category: 'Workshop',
				work_center: 'Shop',
				unit: 'hr',
				default_rate: 95,
				metadata: {},
				is_active: true
			}
		],
		equipmentRateCards: [],
		subcontractRateCards: [],
		costComponentPresets: [
			{
				id: 'preset-1',
				code: 'STD',
				name: 'Standard fabrication preset',
				aliases: ['fab starter', 'standard fab'],
				description: 'Fabrication labour and handling scaffold',
				is_active: true,
				components: [
					{
						category: 'labour',
						source_type: 'labour_rate_card',
						source_id: 'labour-1',
						name: 'Fabrication labour',
						description: 'Shop',
						quantity: 1,
						unit: 'hr',
						unit_rate: 95,
						formula: {},
						metadata: {},
						sort_order: 0
					}
				]
			}
		],
		estimateTemplates: [
			{
				id: 'template-1',
				code: 'STAIR',
				name: 'Stair access estimate',
				aliases: ['access stairs', 'stair package'],
				description: 'General stair access structure and notes',
				is_active: true,
				estimate: {
					scope_summary: 'Template stair package',
					notes: 'Template note',
					classification_system_id: 'class-steel',
					wbs_root_node_id: null,
					takeoff_items: [
						{
							id: 'template-item-1',
							estimate_asset_id: 'template-asset',
							parent_id: null,
							wbs_node_id: null,
							cost_code_id: 'cost-steel',
							applied_preset_id: 'preset-1',
							applied_preset_name: 'Standard fabrication preset',
							name: 'Stair flight',
							description: 'Template stair flight',
							quantity: 1,
							unit: 'ea',
							properties: {},
							sort_order: 0,
							cost_components: [
								{
									id: 'template-component-1',
									takeoff_item_id: 'template-item-1',
									category: 'material',
									source_type: 'material_catalog',
									source_id: 'material-1',
									name: 'Plate 6 mm',
									description: 'AS/NZS',
									quantity: 1,
									unit: 'ea',
									unit_rate: 25,
									formula: {},
									metadata: {},
									sort_order: 0
								}
							]
						}
					]
				}
			}
		]
	};
}

describe('estimate AI context', () => {
	it('builds a versioned context snapshot with schema and field semantics', () => {
		const snapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});

		expect(snapshot.version).toBe('estimate-ai-context-v2');
		expect(snapshot.asset_context).toMatchObject({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade'
		});
		expect(snapshot.schema.allowedCategories).toContain('material');
		expect(snapshot.current_estimate_state).toMatchObject({
			seededHeaderFields: ['scope_summary'],
			hasDraftedStructure: false
		});
		expect(snapshot.field_semantics.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'estimate_setup' }),
				expect.objectContaining({ id: 'takeoff_items' }),
				expect.objectContaining({ id: 'cost_components' })
			])
		);
		expect(snapshot.reference_data).toMatchObject({
			classificationSystems: [expect.objectContaining({ id: 'class-steel' })],
			costCodes: [expect.objectContaining({ id: 'cost-steel', path: '100 Fabrication' })]
		});
		expect(snapshot.field_semantics.fields).toEqual(
			expect.objectContaining({
				takeoff_item_quantity: expect.objectContaining({ label: 'Quantity' }),
				cost_component_unit_rate: expect.objectContaining({ label: 'Rate' })
			})
		);
	});

	it('builds review blockers for invalid references and category-incompatible units', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: 'missing-classification',
			wbs_root_node_id: 'missing-root',
			issues: [],
			takeoff_items: [
				{
					name: 'Plate',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: 'unknown-cost-reference',
					wbs_node_id: 'unknown-structure-reference',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'material_catalog',
							source_id: 'missing-material',
							name: 'Workshop labour',
							description: '',
							quantity: 1,
							unit: 'ea',
							unit_rate: 95,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.preflight.blockerCount).toBeGreaterThan(0);
		expect(review.preflight.canFinalize).toBe(false);
		expect(review.headerFields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'header.wbs_root_node_id', status: 'unresolved' })
			])
		);
		expect(review.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_wbs_root' }),
				expect.objectContaining({ code: 'invalid_cost_code' }),
				expect.objectContaining({ code: 'invalid_wbs_node' }),
				expect.objectContaining({ code: 'invalid_material_source' }),
				expect.objectContaining({ code: 'invalid_component_unit_category' })
			])
		);
	});

	it('treats zero-rate rows as commercial blockers even when no mapping field is open', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Unpriced labour',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.5, extraction: 0.5, mapping: 0.5, quantity: 0.5 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Lathe operator',
							description: '',
							quantity: 1,
							unit: 'hr',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.5, extraction: 0.5, mapping: 0.5, quantity: 0.5 },
							mapping_status: 'unresolved'
						}
					]
				}
			]
		};
		const review = buildEstimateMappingReview({ draft, contextSnapshot });
		expect(review.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'missing_component_rate' })])
		);
		expect(review.preflight.blockerCount).toBeGreaterThan(0);
		expect(review.preflight.canFinalize).toBe(false);
	});

	it('resolves unique exact classification and structure names without semantic matching', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: 'Steel codes',
			wbs_root_node_id: 'Area A',
			issues: [],
			takeoff_items: []
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.classification_system_id).toBe('class-steel');
		expect(review.reconciledDraft.wbs_root_node_id).toBe('wbs-root');
		expect(review.issues.some((issue) => issue.code.startsWith('semantic_'))).toBe(false);
		expect(review.preflight.canFinalize).toBe(true);
	});

	it('resolves unique exact cost-code and structure names without semantic matching', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: 'STEEL',
			wbs_root_node_id: 'Area A',
			issues: [],
			takeoff_items: [
				{
					name: 'Canopy works',
					description: 'Fabrication in Area A',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: 'fabrication',
					wbs_node_id: 'Area A',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
					open_questions: [],
					cost_components: []
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.classification_system_id).toBe('class-steel');
		expect(review.reconciledDraft.takeoff_items[0]?.cost_code_id).toBe('cost-steel');
		expect(review.reconciledDraft.takeoff_items[0]?.wbs_node_id).toBe('wbs-root');
		expect(review.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_cost_code' }),
				expect.objectContaining({ code: 'invalid_wbs_node' })
			])
		);
		expect(review.preflight.canFinalize).toBe(true);
	});

	it('keeps approximate non-source references unresolved instead of semantically auto-linking them', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: 'steel coding',
			wbs_root_node_id: 'A Area A zone',
			applied_template_id: null,
			applied_template_name: 'stair access structure',
			issues: [],
			takeoff_items: [
				{
					name: 'Canopy fabrication works',
					description: 'Fabrication in the factory area',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: 'fabrication work',
					wbs_node_id: 'factory Area A zone',
					applied_preset_id: null,
					applied_preset_name: 'standard fabrication handling',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.4, quantity: 0.9 },
					open_questions: [],
					cost_components: []
				}
			]
		};

		const review = buildEstimateMappingReview({ draft, contextSnapshot });

		expect(review.reconciledDraft).toMatchObject({
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null
		});
		expect(review.reconciledDraft.takeoff_items[0]).toMatchObject({
			cost_code_id: null,
			wbs_node_id: null,
			applied_preset_id: null
		});
		expect(review.issues.some((issue) => issue.code.startsWith('semantic_'))).toBe(false);
		expect(review.preflight.canFinalize).toBe(true);
	});

	it('rejects an explicit source id when its category does not match the drafted component', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			issues: [],
			takeoff_items: [
				{
					name: 'Crew hours',
					description: '',
					quantity: 1,
					unit: 'hr',
					sort_order: 0,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.4, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'material_catalog',
							source_id: 'material-1',
							name: 'Crew hours',
							description: '',
							quantity: 1,
							unit: 'hr',
							unit_rate: 25,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: {
								overall: 0.7,
								extraction: 0.8,
								mapping: 0.4,
								quantity: 0.9
							},
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({ draft, contextSnapshot });
		const component = review.reconciledDraft.takeoff_items[0]?.cost_components[0];

		expect(component).toMatchObject({
			category: 'labour',
			source_type: 'manual',
			source_id: null,
			mapping_status: 'unresolved'
		});
		expect(component?.unit_rate).not.toBe(25);
		expect(review.preflight.canFinalize).toBe(false);
	});

	it('uses only the retrieved catalogue rate and blocks when that record has no rate', () => {
		const tableSnapshot = createTableSnapshot();
		tableSnapshot.materialCatalogItems[0]!.default_rate = 0;
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot,
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			issues: [],
			takeoff_items: [
				{
					name: 'Plate package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Plate 6 mm',
							description: '',
							quantity: 1,
							unit: 'ea',
							unit_rate: 999,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: {
								overall: 0.8,
								extraction: 0.8,
								mapping: 0.7,
								quantity: 0.9
							},
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({ draft, contextSnapshot });
		const component = review.reconciledDraft.takeoff_items[0]?.cost_components[0];

		expect(component).toMatchObject({
			source_type: 'material_catalog',
			source_id: 'material-1',
			unit_rate: 0,
			mapping_status: 'unresolved'
		});
		expect(review.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'missing_component_rate' })])
		);
		expect(review.preflight.canFinalize).toBe(false);
	});

	it('recomputes the review after overrides so clear-or-map decisions unblock finalise', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: 'missing-classification',
			wbs_root_node_id: 'missing-root',
			issues: [],
			takeoff_items: [
				{
					name: 'Plate',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: 'cost-steel',
					wbs_node_id: 'missing-wbs',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'material_catalog',
							source_id: 'missing-material',
							name: 'Workshop labour',
							description: '',
							quantity: 1,
							unit: 'ea',
							unit_rate: 95,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot,
			overrides: {
				'header.classification_system_id': 'class-steel',
				'header.wbs_root_node_id': 'wbs-root',
				'takeoff_items[0].wbs_node_id': 'wbs-root',
				'takeoff_items[0].cost_components[0].source_id': ESTIMATE_MAPPING_CLEAR_VALUE,
				'takeoff_items[0].cost_components[0].unit': 'hr'
			}
		});

		expect(review.preflight.blockerCount).toBe(0);
		expect(review.preflight.canFinalize).toBe(true);
		expect(review.reconciledDraft.classification_system_id).toBe('class-steel');
		expect(review.reconciledDraft.wbs_root_node_id).toBe('wbs-root');
		expect(review.reconciledDraft.applied_template_id).toBeNull();
		expect(review.reconciledDraft.takeoff_items[0]?.wbs_node_id).toBe('wbs-root');
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_id).toBeNull();
		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null,
			unit: 'hr',
			mapping_status: 'manual'
		});
	});

	it('seeds template and preset scaffolds, then overlays AI rows while preserving manual parity', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'Fabricated access platform package',
			notes: 'AI note',
			applied_template_id: null,
			applied_template_name: 'Stair access estimate',
			issues: [],
			takeoff_items: [
				{
					name: 'Stair flight',
					description: 'Fabricated access stair',
					quantity: 2,
					unit: 'ea',
					sort_order: 0,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'steel access material',
							description: '6mm stair plate for access assembly',
							quantity: 2,
							unit: 'ea',
							unit_rate: 20,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({ draft, contextSnapshot });
		const item = review.reconciledDraft.takeoff_items[0]!;

		expect(review.reconciledDraft.applied_template_id).toBe('template-1');
		expect(item.applied_preset_id).toBe('preset-1');
		expect(item.cost_components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Plate 6 mm',
					source_id: 'material-1',
					source_type: 'material_catalog'
				}),
				expect.objectContaining({
					name: 'Fabrication labour',
					source_id: 'labour-1',
					source_type: 'labour_rate_card'
				})
			])
		);
		expect(review.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_estimate_template' }),
				expect.objectContaining({ code: 'invalid_cost_component_preset' })
			])
		);
	});

	it('normalises proxied template and preset records into plain AI snapshot data', () => {
		const proxiedMetadata = new Proxy(
			{
				source: 'live-state',
				aliases: ['6mm plate', 'plate six']
			},
			{}
		);
		const proxiedPresetComponents = new Proxy(
			[
				{
					category: 'labour',
					source_type: 'labour_rate_card',
					source_id: 'labour-1',
					name: 'Fabrication labour',
					description: 'Shop',
					quantity: 1,
					unit: 'hr',
					unit_rate: 95,
					formula: {},
					metadata: new Proxy({ seeded: true }, {}),
					sort_order: 0
				}
			],
			{}
		);
		const proxiedTemplateEstimate = new Proxy(
			{
				scope_summary: 'Template stair package',
				notes: 'Template note',
				classification_system_id: 'class-steel',
				wbs_root_node_id: null,
				takeoff_items: [
					{
						id: 'template-item-1',
						estimate_asset_id: 'template-asset',
						parent_id: null,
						wbs_node_id: null,
						cost_code_id: 'cost-steel',
						applied_preset_id: 'preset-1',
						applied_preset_name: 'Standard fabrication preset',
						name: 'Stair flight',
						description: 'Template stair flight',
						quantity: 1,
						unit: 'ea',
						properties: new Proxy({ stage: 'seeded' }, {}),
						sort_order: 0,
						cost_components: [
							{
								id: 'template-component-1',
								takeoff_item_id: 'template-item-1',
								category: 'material',
								source_type: 'material_catalog',
								source_id: 'material-1',
								name: 'Plate 6 mm',
								description: 'AS/NZS',
								quantity: 1,
								unit: 'ea',
								unit_rate: 25,
								formula: {},
								metadata: new Proxy({ seeded: true }, {}),
								sort_order: 0
							}
						]
					}
				]
			},
			{}
		);

		const snapshot = normaliseAiTableSnapshot({
			...createTableSnapshot(),
			materialCatalogItems: [
				{
					id: 'material-1',
					code: 'PL-6',
					name: 'Plate 6 mm',
					aliases: ['6mm plate', 'plate six'],
					category: 'Plate',
					specification: 'AS/NZS',
					unit: 'ea',
					default_rate: 25,
					metadata: proxiedMetadata,
					is_active: true
				}
			],
			costComponentPresets: [
				{
					id: 'preset-1',
					code: 'STD',
					name: 'Standard fabrication preset',
					aliases: ['fab starter', 'standard fab'],
					description: 'Fabrication labour and handling scaffold',
					is_active: true,
					components: proxiedPresetComponents
				}
			],
			estimateTemplates: [
				{
					id: 'template-1',
					code: 'STAIR',
					name: 'Stair access estimate',
					aliases: ['access stairs', 'stair package'],
					description: 'General stair access structure and notes',
					is_active: true,
					estimate: proxiedTemplateEstimate
				}
			]
		});

		expect(snapshot.materialCatalogItems[0]?.metadata).toEqual({
			source: 'live-state',
			aliases: ['6mm plate', 'plate six']
		});
		expect(snapshot.costComponentPresets[0]?.components).toEqual([
			expect.objectContaining({
				name: 'Fabrication labour',
				metadata: { seeded: true }
			})
		]);
		expect(snapshot.estimateTemplates[0]?.estimate).toEqual(
			expect.objectContaining({
				scope_summary: 'Template stair package',
				takeoff_items: [
					expect.objectContaining({
						name: 'Stair flight',
						properties: { stage: 'seeded' }
					})
				]
			})
		);
	});

	it('preserves seeded setup context by default when AI suggests different header mappings', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate({
				scope_summary: 'User scope',
				classification_system_id: 'class-steel',
				wbs_root_node_id: 'wbs-root'
			})
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI alternate scope',
			notes: '',
			classification_system_id: 'missing-classification',
			wbs_root_node_id: 'missing-root',
			issues: [],
			takeoff_items: []
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft).toMatchObject({
			scope_summary: 'User scope',
			classification_system_id: 'class-steel',
			wbs_root_node_id: 'wbs-root'
		});
		expect(review.preflight.canFinalize).toBe(true);
		expect(review.headerFields).toEqual([]);
		expect(review.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'seeded_scope_summary_preserved', severity: 'info' })
			])
		);
	});

	it('auto-links a unique strong workspace source match with manual-dropdown parity fields', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Plate package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.9, extraction: 0.9, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Plate 6 mm',
							description: 'AS/NZS',
							quantity: 2,
							unit: 'ea',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'material_catalog',
			source_id: 'material-1',
			name: 'Plate 6 mm',
			description: 'AS/NZS',
			unit: 'ea',
			unit_rate: 25,
			mapping_status: 'matched'
		});
		expect(review.items[0]?.componentFields).toEqual([]);
	});

	it('auto-links the highest-scoring viable workspace source match even when close alternatives exist', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				materialCatalogItems: [
					...createTableSnapshot().materialCatalogItems,
					{
						id: 'material-2',
						code: 'PL-8',
						name: 'Plate 8 mm',
						category: 'Plate',
						specification: 'AS/NZS',
						unit: 'ea',
						default_rate: 35,
						metadata: {},
						is_active: true
					}
				]
			},
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Plate package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.7, mapping: 0.4, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: '6mm plate',
							description: 'AS/NZS plate',
							quantity: 2,
							unit: 'ea',
							unit_rate: 20,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.6, extraction: 0.6, mapping: 0.3, quantity: 0.8 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'material_catalog',
			source_id: 'material-1',
			name: 'Plate 6 mm',
			description: 'AS/NZS',
			unit: 'ea',
			unit_rate: 25,
			mapping_status: 'matched',
			metadata: expect.objectContaining({
				ai_match: expect.objectContaining({
					strategy: 'exact_source_match',
					candidateCount: 1,
					score: expect.any(Number),
					signals: expect.arrayContaining(['exact_name_code_or_alias', 'unit_match'])
				})
			})
		});
	});

	it('keeps a duplicate exact source alias unresolved as a commercial blocker', () => {
		const tableSnapshot = createTableSnapshot();
		tableSnapshot.materialCatalogItems.push({
			id: 'material-2',
			code: 'PL-6-B',
			name: 'Alternate 6 mm plate',
			aliases: ['6mm plate'],
			category: 'Plate',
			specification: 'Alternate grade',
			unit: 'ea',
			default_rate: 30,
			metadata: {},
			is_active: true
		});
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot,
			currentEstimate: createEstimate({ scope_summary: '', notes: '' })
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			issues: [],
			takeoff_items: [
				{
					name: 'Plate package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.4, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: '6mm plate',
							description: '',
							quantity: 1,
							unit: 'ea',
							unit_rate: 999,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: {
								overall: 0.8,
								extraction: 0.8,
								mapping: 0.4,
								quantity: 0.9
							},
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({ draft, contextSnapshot });
		const component = review.reconciledDraft.takeoff_items[0]?.cost_components[0];

		expect(component).toMatchObject({
			source_type: 'manual',
			source_id: null,
			unit_rate: 0,
			mapping_status: 'unresolved'
		});
		expect(review.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'ambiguous_linked_source' })])
		);
		expect(review.preflight.canFinalize).toBe(false);
	});

	it('filters placeholder reference records out of the AI snapshot', () => {
		const snapshot = normaliseAiTableSnapshot({
			...createTableSnapshot(),
			costCodes: [
				...createTableSnapshot().costCodes,
				{
					id: 'cost-code-junk',
					classification_system_id: 'class-steel',
					parent_id: null,
					code: 'NAME',
					name: '05 50 00',
					description: 'Metal fabrications',
					is_active: true
				}
			],
			classificationSystems: [
				...createTableSnapshot().classificationSystems,
				{
					id: 'classification-junk',
					code: 'WEFWEF',
					name: 'efewfwe',
					type: 'uniformat',
					is_active: true
				}
			],
			wbsNodes: [
				...createTableSnapshot().wbsNodes,
				{
					id: 'wbs-junk',
					parent_id: null,
					code: 'TMP',
					name: 'Test',
					type: 'zone'
				}
			],
			materialCatalogItems: [
				...createTableSnapshot().materialCatalogItems,
				{
					id: 'material-junk',
					code: null,
					name: 'Name',
					aliases: [],
					category: 'Plate',
					specification: '',
					unit: 'ea',
					default_rate: 1,
					metadata: {},
					is_active: true
				}
			],
			equipmentRateCards: [
				{
					id: 'equipment-junk',
					code: 'ERFERF',
					name: 'erferf',
					aliases: [],
					category: 'Workshop',
					work_center: 'Shop',
					unit: 'hr',
					default_rate: 10,
					metadata: {},
					is_active: true
				}
			],
			costComponentPresets: [
				...createTableSnapshot().costComponentPresets,
				{
					id: 'preset-junk',
					code: '1234',
					name: 'Test',
					aliases: [],
					description: 'Placeholder preset',
					is_active: true,
					components: []
				}
			]
		});

		expect(snapshot.classificationSystems.map((entry) => entry.id)).not.toContain(
			'classification-junk'
		);
		expect(snapshot.costCodes.map((entry) => entry.id)).not.toContain('cost-code-junk');
		expect(snapshot.wbsNodes.map((entry) => entry.id)).not.toContain('wbs-junk');
		expect(snapshot.materialCatalogItems.map((entry) => entry.id)).not.toContain('material-junk');
		expect(snapshot.equipmentRateCards.map((entry) => entry.id)).not.toContain('equipment-junk');
		expect(snapshot.costComponentPresets.map((entry) => entry.id)).not.toContain('preset-junk');
	});

	it('does not auto-link a material source when the drafted name has extra quantity text', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Canopy package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary: '',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Canopy package',
					description: 'Bundled canopy estimate',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.7, mapping: 0.4, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Plate 6 mm: 2 ea',
							description: 'AS/NZS plate',
							quantity: 2,
							unit: 'ea',
							unit_rate: 20,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.6, extraction: 0.6, mapping: 0.3, quantity: 0.8 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null,
			name: 'Plate 6 mm: 2 ea',
			mapping_status: 'manual'
		});
		expect(
			review.reconciledDraft.takeoff_items[0]?.cost_components[0]?.metadata
		).not.toHaveProperty('ai_match');
	});

	it('keeps only classification systems that are connected to live cost codes or templates', () => {
		const snapshot = normaliseAiTableSnapshot({
			...createTableSnapshot(),
			classificationSystems: [
				...createTableSnapshot().classificationSystems,
				{
					id: 'classification-orphan',
					code: 'UNUSED',
					name: 'Unused classification',
					type: 'custom',
					is_active: true
				}
			]
		});

		expect(snapshot.classificationSystems.map((entry) => entry.id)).toEqual(['class-steel']);
	});

	it('auto-corrects category for an exact cross-category source match when the draft uses a generic scaffold unit', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				subcontractRateCards: [
					{
						id: 'subcontract-1',
						code: 'SUB-PAINT-02',
						name: 'Protective Coating',
						aliases: ['paint system', 'intumescent coating', 'coating crew'],
						category: 'Coatings',
						unit: 'm2',
						default_rate: 24.5,
						metadata: { supplier: 'FireSafe' },
						is_active: true
					}
				]
			},
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Canopy package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.7, mapping: 0.4, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Intumescent Coating',
							description: 'Fire coating requirement',
							quantity: 1,
							unit: 'lot',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.3, quantity: 0.8 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			category: 'material',
			source_type: 'manual',
			source_id: null,
			name: 'Intumescent Coating',
			unit: 'lot',
			unit_rate: 0,
			mapping_status: 'unresolved'
		});
		expect(review.issues).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'cross_category_source_match' })])
		);
	});

	it('keeps manual rows unresolved when a hard unit mismatch makes the best candidate invalid', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Plate package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.7, mapping: 0.4, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Plate 6 mm',
							description: 'AS/NZS',
							quantity: 2,
							unit: 'hr',
							unit_rate: 20,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.6, extraction: 0.6, mapping: 0.3, quantity: 0.8 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null,
			name: 'Plate 6 mm',
			unit: 'hr',
			unit_rate: 20,
			mapping_status: 'manual'
		});
	});

	it('auto-links compatible-family labour matches and flags them for review when the units differ', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				labourRateCards: [
					...createTableSnapshot().labourRateCards,
					{
						id: 'labour-install',
						code: 'LAB-INSTALL-001',
						name: 'Site installation crew',
						aliases: ['install crew', 'installation labour'],
						category: 'Field',
						work_center: 'Field',
						unit: 'day',
						default_rate: 780,
						metadata: {},
						is_active: true
					}
				]
			},
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Install labour',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.7, mapping: 0.4, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Installers',
							description: 'Site install labour',
							quantity: 2,
							unit: 'ea',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.5, extraction: 0.6, mapping: 0.5, quantity: 0.7 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null,
			name: 'Installers',
			unit: 'ea',
			unit_rate: 0,
			mapping_status: 'unresolved'
		});
		expect(review.issues).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'semantic_source_match' })])
		);
	});

	it('normalises valid linked source rows to the same field bundle as the manual dropdown flow', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Labour package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'labour_rate_card',
							source_id: 'labour-1',
							name: 'AI labour label',
							description: 'AI freehand description',
							quantity: 4,
							unit: 'ea',
							unit_rate: 1,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.7, mapping: 0.7, quantity: 0.7 },
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'labour_rate_card',
			source_id: 'labour-1',
			name: 'Fabrication labour',
			description: 'Shop',
			unit: 'hr',
			unit_rate: 95,
			mapping_status: 'matched'
		});
	});

	it('links an estimate template and takeoff preset from unique exact names', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'Stair access estimate for fabrication and install',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: 'Stair access estimate',
			issues: [],
			takeoff_items: [
				{
					name: 'Standard fabrication preset',
					description: 'Fabrication labour and handling scaffold',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: 'Standard fabrication preset',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Fabrication labour',
							description: 'Shop',
							quantity: 4,
							unit: 'hr',
							unit_rate: 95,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.7, mapping: 0.7, quantity: 0.7 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft).toMatchObject({
			applied_template_id: 'template-1',
			applied_template_name: 'Stair access estimate'
		});
		expect(review.reconciledDraft.takeoff_items[0]).toMatchObject({
			applied_preset_id: 'preset-1',
			applied_preset_name: 'Standard fabrication preset'
		});
	});

	it('keeps extra linked and custom rows when template and preset scaffolds are applied', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'Stair access estimate for fabrication and install',
			notes: 'Include bespoke landing trim.',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: 'Stair package',
			issues: [],
			takeoff_items: [
				{
					name: 'Stair flight',
					description: 'Fabricated access stair',
					quantity: 2,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: 'fab starter',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: '6mm plate',
							description: 'AS/NZS plate',
							quantity: 2,
							unit: 'ea',
							unit_rate: 20,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'manual'
						},
						{
							category: 'misc',
							source_type: 'manual',
							source_id: null,
							name: 'Custom landing trim',
							description: 'Bespoke flashing and trim allowance',
							quantity: 1,
							unit: 'lot',
							unit_rate: 125,
							formula: {},
							metadata: {},
							sort_order: 1,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.7, mapping: 0.5, quantity: 0.8 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		const item = review.reconciledDraft.takeoff_items[0]!;
		expect(review.reconciledDraft.applied_template_id).toBe('template-1');
		expect(item.applied_preset_id).toBe('preset-1');
		expect(item.cost_components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Plate 6 mm',
					source_type: 'material_catalog',
					source_id: 'material-1'
				}),
				expect.objectContaining({
					name: 'Fabrication labour',
					source_type: 'labour_rate_card',
					source_id: 'labour-1'
				}),
				expect.objectContaining({
					name: 'Custom landing trim',
					source_type: 'manual',
					source_id: null,
					category: 'misc'
				})
			])
		);
	});

	it('applies an explicitly named canopy template and preset without semantic matching', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				costComponentPresets: [
					{
						id: 'preset-canopy',
						code: 'QA-PRESET-001',
						name: 'QA Canopy Install Scaffold',
						aliases: ['canopy starter', 'install scaffold', 'standard canopy'],
						description: 'Canopy install scaffold captured from live estimate editor.',
						is_active: true,
						components: [
							{
								category: 'material',
								source_type: 'manual',
								source_id: null,
								name: 'Structural Steel',
								description: 'Prices based on OneSteel/McMahon current list (March 2026).',
								quantity: 1,
								unit: 'lot',
								unit_rate: 0,
								formula: {},
								metadata: {},
								sort_order: 0
							},
							{
								category: 'labour',
								source_type: 'manual',
								source_id: null,
								name: 'Installation Labour',
								description:
									'Installation window 2026-06-01 to 2026-06-14. Union EBA conditions (metal construction award) including 2-day weather contingency.',
								quantity: 14,
								unit: 'day',
								unit_rate: 0,
								formula: {},
								metadata: {},
								sort_order: 1
							},
							{
								category: 'equipment',
								source_type: 'manual',
								source_id: null,
								name: 'Crane Hire',
								description: 'Coates Hire Dandenong branch.',
								quantity: 1,
								unit: 'fixed',
								unit_rate: 0,
								formula: {},
								metadata: {},
								sort_order: 2
							}
						]
					}
				],
				estimateTemplates: [
					{
						id: 'template-noise',
						code: '11111',
						name: 'Name',
						aliases: [],
						description: '',
						is_active: true,
						estimate: {
							scope_summary:
								'Structural Steel Canopy at Henderson Logistics, including structural steel framing, Colorbond sheeting, intumescent coating, installation labour, and crane hire.',
							notes:
								'Installation window is 2026-06-01 to 2026-06-14 (14 days) including a 2-day weather delay contingency.',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: [
								{
									id: 'template-noise-item-1',
									estimate_asset_id: 'template-noise-asset',
									parent_id: null,
									wbs_node_id: null,
									cost_code_id: null,
									applied_preset_id: 'preset-canopy',
									applied_preset_name: 'QA Canopy Install Scaffold',
									name: 'Structural Steel Canopy',
									description: 'Fabrication and installation of the structural steel canopy.',
									quantity: 1,
									unit: 'job',
									properties: {},
									sort_order: 0,
									cost_components: [
										{
											id: 'template-noise-component-1',
											takeoff_item_id: 'template-noise-item-1',
											category: 'material',
											source_type: 'manual',
											source_id: null,
											name: 'Structural Steel',
											description: 'Prices based on OneSteel/McMahon current list (March 2026).',
											quantity: 1,
											unit: 'lot',
											unit_rate: 0,
											formula: {},
											metadata: {},
											sort_order: 0
										}
									]
								}
							]
						}
					},
					{
						id: 'template-canopy',
						code: 'QA-TEMPLATE-001',
						name: 'QA Canopy Package',
						aliases: ['canopy package', 'structural canopy', 'logistics canopy'],
						description: 'Canopy package template captured from live estimate editor.',
						is_active: true,
						estimate: {
							scope_summary:
								'Structural Steel Canopy at Henderson Logistics, including structural steel framing, Colorbond sheeting, intumescent coating, installation labour, and crane hire.',
							notes:
								'Installation window is 2026-06-01 to 2026-06-14 (14 days) including a 2-day weather delay contingency.',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: [
								{
									id: 'template-canopy-item-1',
									estimate_asset_id: 'template-asset',
									parent_id: null,
									wbs_node_id: null,
									cost_code_id: null,
									applied_preset_id: 'preset-canopy',
									applied_preset_name: 'QA Canopy Install Scaffold',
									name: 'Structural Steel Canopy',
									description: 'Fabrication and installation of the structural steel canopy.',
									quantity: 1,
									unit: 'job',
									properties: {},
									sort_order: 0,
									cost_components: [
										{
											id: 'template-canopy-component-1',
											takeoff_item_id: 'template-canopy-item-1',
											category: 'material',
											source_type: 'manual',
											source_id: null,
											name: 'Structural Steel',
											description: 'Prices based on OneSteel/McMahon current list (March 2026).',
											quantity: 1,
											unit: 'lot',
											unit_rate: 0,
											formula: {},
											metadata: {},
											sort_order: 0
										}
									]
								}
							]
						}
					}
				]
			},
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'Structural Steel Canopy project at Henderson Logistics.',
			notes:
				'Pricing based on OneSteel/McMahon current list (March 2026). Labour rates must reflect union EBA conditions under the metal construction award. Crane hire rates from Coates Hire Dandenong branch.',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: 'QA Canopy Package',
			issues: [],
			takeoff_items: [
				{
					name: 'Structural Steel Canopy',
					description: 'Fabrication and installation of the structural steel canopy.',
					quantity: 1,
					unit: 'job',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: 'QA Canopy Install Scaffold',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.9, mapping: 0.4, quantity: 0.6 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Structural Steel Material',
							description:
								'Pricing based on OneSteel/McMahon current list (March 2026). Requires compliance with AS 4100.',
							quantity: 1,
							unit: 'lot',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.9, mapping: 0.2, quantity: 0.2 },
							mapping_status: 'unresolved'
						},
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Installation Labour',
							description:
								'Installation window 2026-06-01 to 2026-06-14. Union EBA conditions (metal construction award) including 2-day weather contingency.',
							quantity: 14,
							unit: 'day',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 1,
							evidence_refs: [],
							confidence: { overall: 0.85, extraction: 0.9, mapping: 0.2, quantity: 0.9 },
							mapping_status: 'unresolved'
						},
						{
							category: 'equipment',
							source_type: 'manual',
							source_id: null,
							name: 'Crane Hire',
							description: 'Coates Hire Dandenong branch.',
							quantity: 1,
							unit: 'fixed',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 2,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.9, mapping: 0.2, quantity: 0.4 },
							mapping_status: 'unresolved'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.applied_template_id).toBe('template-canopy');
		expect(review.reconciledDraft.applied_template_name).toBe('QA Canopy Package');
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_id).toBe('preset-canopy');
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_name).toBe(
			'QA Canopy Install Scaffold'
		);
		expect(review.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_estimate_template' }),
				expect.objectContaining({ code: 'invalid_cost_component_preset' })
			])
		);
	});

	it('uses unique exact template and preset aliases without semantic structure matching', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				wbsNodes: [
					{ id: 'wbs-canopy', parent_id: null, code: 'CAN', name: 'Canopy Zone', type: 'zone' },
					{ id: 'wbs-stair', parent_id: null, code: 'STR', name: 'Stair Zone', type: 'zone' }
				],
				costCodes: [
					{
						id: 'cost-canopy',
						classification_system_id: 'class-steel',
						parent_id: null,
						code: '200',
						name: 'Canopy package',
						description: 'Canopy framing',
						is_active: true
					},
					{
						id: 'cost-stair',
						classification_system_id: 'class-steel',
						parent_id: null,
						code: '300',
						name: 'Stair package',
						description: 'Stair framing',
						is_active: true
					}
				],
				costComponentPresets: [
					{
						id: 'preset-stair',
						code: 'QA-PRESET-STAIR',
						name: 'Generic install scaffold',
						aliases: ['stair install'],
						description: 'Shared install scaffold',
						is_active: true,
						components: [
							{
								category: 'labour',
								source_type: 'labour_rate_card',
								source_id: 'labour-1',
								name: 'Fabrication labour',
								description: 'Shop',
								quantity: 1,
								unit: 'hr',
								unit_rate: 95,
								formula: {},
								metadata: {},
								sort_order: 0
							}
						]
					},
					{
						id: 'preset-canopy',
						code: 'QA-PRESET-CANOPY',
						name: 'Generic install scaffold',
						aliases: ['canopy install'],
						description: 'Shared install scaffold',
						is_active: true,
						components: [
							{
								category: 'material',
								source_type: 'material_catalog',
								source_id: 'material-1',
								name: 'Plate 6 mm',
								description: 'AS/NZS',
								quantity: 1,
								unit: 'ea',
								unit_rate: 25,
								formula: {},
								metadata: {},
								sort_order: 0
							}
						]
					}
				],
				estimateTemplates: [
					{
						id: 'template-stair-generic',
						code: 'QA-TEMPLATE-STAIR',
						name: 'General package',
						aliases: ['stair package'],
						description: 'Shared estimate scaffold',
						is_active: true,
						estimate: {
							scope_summary: 'General package',
							notes: 'Shared estimate scaffold',
							classification_system_id: 'class-steel',
							wbs_root_node_id: 'wbs-stair',
							takeoff_items: [
								{
									id: 'template-stair-item-1',
									estimate_asset_id: 'template-asset',
									parent_id: null,
									wbs_node_id: 'wbs-stair',
									cost_code_id: 'cost-stair',
									applied_preset_id: 'preset-stair',
									applied_preset_name: 'Generic install scaffold',
									name: 'General package',
									description: 'Shared estimate scaffold',
									quantity: 1,
									unit: 'ea',
									properties: {},
									sort_order: 0,
									cost_components: []
								}
							]
						}
					},
					{
						id: 'template-canopy-generic',
						code: 'QA-TEMPLATE-CANOPY',
						name: 'General package',
						aliases: ['canopy package'],
						description: 'Shared estimate scaffold',
						is_active: true,
						estimate: {
							scope_summary: 'General package',
							notes: 'Shared estimate scaffold',
							classification_system_id: 'class-steel',
							wbs_root_node_id: 'wbs-canopy',
							takeoff_items: [
								{
									id: 'template-canopy-item-1',
									estimate_asset_id: 'template-asset',
									parent_id: null,
									wbs_node_id: 'wbs-canopy',
									cost_code_id: 'cost-canopy',
									applied_preset_id: 'preset-canopy',
									applied_preset_name: 'Generic install scaffold',
									name: 'General package',
									description: 'Shared estimate scaffold',
									quantity: 1,
									unit: 'ea',
									properties: {},
									sort_order: 0,
									cost_components: []
								}
							]
						}
					}
				]
			},
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary: 'General package',
			notes: 'Shared estimate scaffold',
			classification_system_id: 'class-steel',
			wbs_root_node_id: 'wbs-canopy',
			applied_template_id: null,
			applied_template_name: 'canopy package',
			issues: [],
			takeoff_items: [
				{
					name: 'General package',
					description: 'Shared estimate scaffold',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: 'cost-canopy',
					wbs_node_id: 'wbs-canopy',
					applied_preset_id: null,
					applied_preset_name: 'canopy install',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'material_catalog',
							source_id: 'material-1',
							name: 'Plate 6 mm',
							description: 'AS/NZS',
							quantity: 1,
							unit: 'ea',
							unit_rate: 25,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.6, quantity: 0.9 },
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.applied_template_id).toBe('template-canopy-generic');
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_id).toBe('preset-canopy');
	});

	it('applies explicitly named preset-backed templates when header coding is blank', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Canopy package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				costComponentPresets: [
					{
						id: 'preset-canopy-live',
						code: 'QA-PRESET-CANOPY-LIVE',
						name: 'QA Canopy Install Scaffold Clean',
						aliases: ['clean canopy scaffold', 'parity clean'],
						description: 'Preset-backed canopy install scaffold',
						is_active: true,
						components: [
							{
								category: 'labour',
								source_type: 'labour_rate_card',
								source_id: 'labour-1',
								name: 'Site Installer Crew',
								description: 'Field Ops',
								quantity: 14,
								unit: 'day',
								unit_rate: 780,
								formula: {},
								metadata: {},
								sort_order: 0
							},
							{
								category: 'material',
								source_type: 'material_catalog',
								source_id: 'material-1',
								name: 'Structural Steel Material',
								description: 'Primary structural steel package for canopy fabrication.',
								quantity: 1,
								unit: 'lot',
								unit_rate: 6200,
								formula: {},
								metadata: {},
								sort_order: 1
							},
							{
								category: 'equipment',
								source_type: 'equipment_rate_card',
								source_id: 'equipment-1',
								name: 'Crane Hire',
								description: 'Coates Hire Dandenong branch.',
								quantity: 1,
								unit: 'fixed',
								unit_rate: 1850,
								formula: {},
								metadata: {},
								sort_order: 2
							}
						]
					}
				],
				estimateTemplates: [
					{
						id: 'template-canopy-live',
						code: 'QA-TEMPLATE-CANOPY-LIVE',
						name: 'QA Canopy Package Preset Proof Clean',
						aliases: ['clean canopy package', 'preset proof clean', 'parity verified'],
						description: 'Clean canopy template rebuilt from relinked preset-backed estimate.',
						is_active: true,
						estimate: {
							scope_summary: 'Structural Steel Canopy project at Henderson Logistics.',
							notes: 'Pricing based on canopy parity fixture notes.',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: [
								{
									id: 'template-canopy-item-live',
									estimate_asset_id: 'template-asset',
									parent_id: null,
									wbs_node_id: null,
									cost_code_id: null,
									applied_preset_id: 'preset-canopy-live',
									applied_preset_name: 'QA Canopy Install Scaffold Clean',
									name: 'Structural Steel Canopy',
									description:
										'Main canopy structure including engineering and architectural design.',
									quantity: 1,
									unit: 'ea',
									properties: {},
									sort_order: 0,
									cost_components: []
								}
							]
						}
					}
				]
			},
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary: 'Structural Steel Canopy project at Henderson Logistics.',
			notes: 'Pricing based on canopy parity fixture notes.',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: 'QA Canopy Package Preset Proof Clean',
			issues: [],
			takeoff_items: [
				{
					name: 'Structural Steel Canopy',
					description: 'Main canopy structure including engineering and architectural design.',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: 'QA Canopy Install Scaffold Clean',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'labour',
							source_type: 'labour_rate_card',
							source_id: 'labour-1',
							name: 'Site Installer Crew',
							description: 'Field Ops',
							quantity: 14,
							unit: 'day',
							unit_rate: 780,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'matched'
						},
						{
							category: 'material',
							source_type: 'material_catalog',
							source_id: 'material-1',
							name: 'Structural Steel Material',
							description: 'Primary structural steel package for canopy fabrication.',
							quantity: 1,
							unit: 'lot',
							unit_rate: 6200,
							formula: {},
							metadata: {},
							sort_order: 1,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'matched'
						},
						{
							category: 'equipment',
							source_type: 'equipment_rate_card',
							source_id: 'equipment-1',
							name: 'Crane Hire',
							description: 'Coates Hire Dandenong branch.',
							quantity: 1,
							unit: 'fixed',
							unit_rate: 1850,
							formula: {},
							metadata: {},
							sort_order: 2,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.applied_template_id).toBe('template-canopy-live');
		expect(review.reconciledDraft.applied_template_name).toBe(
			'QA Canopy Package Preset Proof Clean'
		);
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_id).toBe('preset-canopy-live');
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_name).toBe(
			'QA Canopy Install Scaffold Clean'
		);
	});

	it('does not auto-link templates or presets when labels contain extra quantity text', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Canopy package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				costComponentPresets: [
					{
						id: 'preset-canopy-live',
						code: 'QA-PRESET-CANOPY-LIVE',
						name: 'QA Canopy Install Scaffold Clean',
						aliases: ['clean canopy scaffold', 'parity clean', 'canopy package'],
						description: 'Preset-backed canopy install scaffold',
						is_active: true,
						components: [
							{
								category: 'labour',
								source_type: 'labour_rate_card',
								source_id: 'labour-1',
								name: 'Site installation crew',
								description: 'Field Ops',
								quantity: 14,
								unit: 'day',
								unit_rate: 780,
								formula: {},
								metadata: {},
								sort_order: 0
							},
							{
								category: 'material',
								source_type: 'material_catalog',
								source_id: 'material-1',
								name: 'Structural steel canopy package',
								description: 'Bundled canopy fabrication supply package',
								quantity: 1,
								unit: 'lot',
								unit_rate: 6200,
								formula: {},
								metadata: {},
								sort_order: 1
							}
						]
					}
				],
				estimateTemplates: [
					{
						id: 'template-canopy-live',
						code: 'QA-TEMPLATE-CANOPY-LIVE',
						name: 'QA Canopy Package Preset Proof Clean',
						aliases: ['clean canopy package', 'preset proof clean', 'parity verified'],
						description: 'Clean canopy template rebuilt from relinked preset-backed estimate.',
						is_active: true,
						estimate: {
							scope_summary: 'Structural Steel Canopy project at Henderson Logistics.',
							notes: 'Pricing based on canopy parity fixture notes.',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: [
								{
									id: 'template-canopy-item-live',
									estimate_asset_id: 'template-asset',
									parent_id: null,
									wbs_node_id: null,
									cost_code_id: null,
									applied_preset_id: 'preset-canopy-live',
									applied_preset_name: 'QA Canopy Install Scaffold Clean',
									name: 'Structural steel canopy package',
									description: 'Bundled canopy fabrication and install package.',
									quantity: 1,
									unit: 'ea',
									properties: {},
									sort_order: 0,
									cost_components: []
								}
							]
						}
					}
				]
			},
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary: 'Structural Steel Canopy project at Henderson Logistics.',
			notes: 'Pricing based on canopy parity fixture notes.',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: 'QA Canopy Package Preset Proof Clean: 1 lot',
			issues: [],
			takeoff_items: [
				{
					name: 'Structural steel canopy package . 1 lot',
					description: 'Bundled canopy fabrication and install package.',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: 'QA Canopy Install Scaffold Clean: 14 day',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'material_catalog',
							source_id: 'material-1',
							name: 'Structural steel canopy package: 1 lot',
							description: 'Bundled canopy fabrication supply package',
							quantity: 1,
							unit: 'lot',
							unit_rate: 6200,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'matched'
						},
						{
							category: 'labour',
							source_type: 'labour_rate_card',
							source_id: 'labour-1',
							name: 'Site installation crew . 14 day',
							description: 'Field Ops',
							quantity: 14,
							unit: 'day',
							unit_rate: 780,
							formula: {},
							metadata: {},
							sort_order: 1,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'matched'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.applied_template_id).toBeNull();
		expect(review.reconciledDraft.applied_template_name).toBeNull();
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_id).toBeNull();
		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_name).toBeNull();
	});

	it('seeds linked cost rows when the draft only returns canopy takeoff names', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Canopy package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				materialCatalogItems: [
					{
						id: 'material-canopy',
						code: 'MAT-CANOPY-001',
						name: 'Structural steel canopy package',
						aliases: [
							'structural steel canopy package',
							'canopy package',
							'rush fabrication',
							'base plates',
							'shop welding'
						],
						category: 'Canopy',
						specification: 'Bundled canopy fabrication supply package',
						unit: 'lot',
						default_rate: 6200,
						metadata: {},
						is_active: true
					}
				],
				labourRateCards: [
					{
						id: 'labour-install',
						code: 'LAB-INSTALL-001',
						name: 'Site installation crew',
						aliases: [
							'site installation crew',
							'installers',
							'after-hours installation labour',
							'site installation'
						],
						category: 'Field',
						work_center: 'Field Ops',
						unit: 'day',
						default_rate: 780,
						metadata: {},
						is_active: true
					}
				],
				costComponentPresets: [],
				estimateTemplates: []
			},
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary: 'Canopy package',
			notes: 'Use bundled pricing.',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Structural steel canopy package',
					description: 'Bundled fabrication supply for the structural steel canopy.',
					quantity: 1,
					unit: 'lot',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.4, extraction: 0.4, mapping: 0.1, quantity: 0.8 },
					open_questions: [],
					cost_components: []
				},
				{
					name: 'Site installation crew',
					description: 'Installation labour for the canopy package.',
					quantity: 14,
					unit: 'day',
					sort_order: 1,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.4, extraction: 0.4, mapping: 0.1, quantity: 0.8 },
					open_questions: [],
					cost_components: []
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			category: 'material',
			source_type: 'material_catalog',
			source_id: 'material-canopy',
			unit: 'lot',
			unit_rate: 6200,
			mapping_status: 'matched'
		});
		expect(review.reconciledDraft.takeoff_items[1]?.cost_components[0]).toMatchObject({
			category: 'labour',
			source_type: 'labour_rate_card',
			source_id: 'labour-install',
			unit: 'day',
			unit_rate: 780,
			mapping_status: 'matched'
		});
		expect(review.issues.some((issue) => issue.code === 'semantic_takeoff_component_seed')).toBe(
			false
		);
	});

	it('does not semantically apply a preset from generic scaffold overlap alone', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Specification package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				...createTableSnapshot(),
				costComponentPresets: [
					{
						id: 'preset-canopy-live',
						code: 'QA-PRESET-CANOPY-LIVE',
						name: 'QA Canopy Install Scaffold Clean',
						aliases: ['clean canopy scaffold', 'canopy install'],
						description: 'Preset-backed canopy install scaffold',
						is_active: true,
						components: [
							{
								category: 'labour',
								source_type: 'labour_rate_card',
								source_id: 'labour-1',
								name: 'Site Installer Crew',
								description: 'Field Ops',
								quantity: 14,
								unit: 'day',
								unit_rate: 780,
								formula: {},
								metadata: {},
								sort_order: 0
							},
							{
								category: 'material',
								source_type: 'manual',
								source_id: null,
								name: 'Structural Steel Material',
								description: 'Primary structural steel package for canopy fabrication.',
								quantity: 1,
								unit: 'lot',
								unit_rate: 6200,
								formula: {},
								metadata: {},
								sort_order: 1
							},
							{
								category: 'equipment',
								source_type: 'manual',
								source_id: null,
								name: 'Crane Hire',
								description: 'Mobile crane',
								quantity: 1,
								unit: 'fixed',
								unit_rate: 1850,
								formula: {},
								metadata: {},
								sort_order: 2
							}
						]
					}
				]
			},
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary: 'Structural steel framing package',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null,
			issues: [],
			takeoff_items: [
				{
					name: '310UB40.4 Grade 300PLUS hot-rolled beam',
					description: 'Primary canopy beam cut to 6.0m lengths',
					quantity: 54,
					unit: 'm',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: '310UB40.4 Grade 300PLUS hot-rolled beam',
							description: 'Manifest rate for primary beam',
							quantity: 1,
							unit: 'm',
							unit_rate: 185.5,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.applied_preset_id).toBeNull();
		expect(
			review.issues.some((issue) => issue.code === 'semantic_cost_component_preset_match')
		).toBe(false);
	});

	it('keeps unmatched manual rows unresolved when no viable workspace source exists', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			issues: [],
			takeoff_items: [
				{
					name: 'Specialty package',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.7, mapping: 0.4, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Galvanised mesh infill panel',
							description: 'Custom non-catalogue infill panel',
							quantity: 2,
							unit: 'ea',
							unit_rate: 80,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.6, extraction: 0.6, mapping: 0.3, quantity: 0.8 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null,
			name: 'Galvanised mesh infill panel',
			unit_rate: 80,
			mapping_status: 'manual'
		});
	});

	it('builds persisted draft matching from the reconciled draft instead of placeholder manual seeds', () => {
		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: createTableSnapshot(),
			currentEstimate: createEstimate()
		});
		const draft: AiDraftEstimate = {
			scope_summary: 'AI scope',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: 'Stair access estimate',
			issues: [],
			takeoff_items: [
				{
					name: 'Stair flight',
					description: 'Fabricated access stair',
					quantity: 2,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: 'Standard fabrication preset',
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'steel access material',
							description: '6mm stair plate for access assembly',
							quantity: 2,
							unit: 'ea',
							unit_rate: 20,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.7, quantity: 0.9 },
							mapping_status: 'manual'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({ draft, contextSnapshot });
		const matching = buildDraftMatchingFromReconciledEstimate({
			draft: review.reconciledDraft,
			contextSnapshot,
			issues: review.issues
		});

		expect(matching.applied_template_id).toBe('template-1');
		expect(matching.takeoff_items[0]).toMatchObject({
			applied_preset_id: 'preset-1'
		});
		expect(matching.takeoff_items[0]?.cost_components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: 'material',
					source_type: 'material_catalog',
					source_id: 'material-1',
					source_name: 'PL-6 Plate 6 mm · Plate',
					mapping_status: 'matched',
					match_strategy: 'explicit_source_id'
				}),
				expect.objectContaining({
					category: 'labour',
					source_type: 'labour_rate_card',
					source_id: 'labour-1',
					source_name: 'FAB Fabrication labour · Workshop · Shop',
					mapping_status: 'matched',
					match_strategy: 'explicit_source_id'
				})
			])
		);
	});

	it('does not semantically apply a template for sparse evidence without anchors or source overlap', () => {
		const tableSnapshot = createTableSnapshot();
		const costComponentPresets: ReturnType<typeof createTableSnapshot>['costComponentPresets'] = [
			{
				id: 'preset-canopy-live',
				code: 'QA-PRESET-CANOPY-LIVE',
				name: 'QA Canopy Install Scaffold Clean',
				aliases: ['clean canopy scaffold'],
				description: 'Preset-backed canopy install scaffold',
				is_active: true,
				components: [
					{
						category: 'labour',
						source_type: 'labour_rate_card',
						source_id: 'labour-1',
						name: 'Site Installer Crew',
						description: 'Field Ops',
						quantity: 14,
						unit: 'day',
						unit_rate: 780,
						formula: {},
						metadata: {},
						sort_order: 0
					}
				]
			}
		];
		tableSnapshot.costComponentPresets = costComponentPresets;
		const estimateTemplates: ReturnType<typeof createTableSnapshot>['estimateTemplates'] = [
			{
				id: 'template-canopy-live',
				code: 'QA-TEMPLATE-CANOPY-LIVE',
				name: 'QA Canopy Package Preset Proof Clean',
				aliases: ['clean canopy package', 'preset proof clean'],
				description: 'Clean canopy template rebuilt from relinked preset-backed estimate.',
				is_active: true,
				estimate: {
					scope_summary: 'Structural Steel Canopy project at Henderson Logistics.',
					notes: 'Pricing based on canopy parity fixture notes.',
					classification_system_id: 'class-steel',
					wbs_root_node_id: null,
					takeoff_items: [
						{
							id: 'template-canopy-item-live',
							estimate_asset_id: 'template-asset',
							parent_id: null,
							wbs_node_id: null,
							cost_code_id: 'cost-steel',
							applied_preset_id: 'preset-canopy-live',
							applied_preset_name: 'QA Canopy Install Scaffold Clean',
							name: 'Structural Steel Canopy',
							description: 'Main canopy structure including engineering and architectural design.',
							quantity: 1,
							unit: 'ea',
							properties: {},
							sort_order: 0,
							cost_components: []
						}
					]
				}
			}
		];
		tableSnapshot.estimateTemplates = estimateTemplates;

		const contextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-bracket',
			assetName: 'sample-bracket',
			projectName: 'Factory upgrade',
			tableSnapshot,
			currentEstimate: createEstimate()
		});

		const draft: AiDraftEstimate = {
			scope_summary:
				"Draft estimate for 'sample-bracket'. Evidence consists of CAD files lacking dimensions, material specifications, and in one case, renderable geometry.",
			notes:
				"Three CAD files were processed. 'sample-bracket.stp' contains metadata only. 'sample-drawing.dxf' shows a basic rectangular profile without dimensions. 'sample-dxf-wire-baseline.dxf' contains only a single line segment. The estimate cannot be accurately priced without further details.",
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null,
			issues: [],
			takeoff_items: [
				{
					name: 'sample-bracket (unspecified)',
					description:
						"Basic rectangular profile derived from 'sample-drawing.dxf'. Missing dimensional data and material specifications.",
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					applied_preset_id: null,
					applied_preset_name: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.4, extraction: 0.8, mapping: 0.3, quantity: 0.1 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Unspecified Material',
							description: 'Material type, grade, and thickness are unspecified.',
							quantity: 1,
							unit: 'ea',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.1, extraction: 0.6, mapping: 0.1, quantity: 0.1 },
							mapping_status: 'unresolved'
						},
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Unspecified Fabrication Labour',
							description: 'Fabrication effort cannot be sized from the sparse drawing.',
							quantity: 1,
							unit: 'hr',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 1,
							evidence_refs: [],
							confidence: { overall: 0.1, extraction: 0.6, mapping: 0.1, quantity: 0.1 },
							mapping_status: 'unresolved'
						}
					]
				}
			]
		};

		const review = buildEstimateMappingReview({
			draft,
			contextSnapshot
		});

		expect(review.reconciledDraft.applied_template_id).toBeNull();
		expect(review.reconciledDraft.applied_template_name).toBeNull();
		expect(review.issues.some((issue) => issue.code === 'semantic_estimate_template_match')).toBe(
			false
		);
	});
});
