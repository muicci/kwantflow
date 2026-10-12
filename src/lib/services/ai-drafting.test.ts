import { describe, expect, it, vi } from 'vitest';
import type {
	AiTextArtifactSourceFormat,
	AiTextArtifactStructureHints,
	AssetFile,
	Estimate
} from '$lib/types/index.js';
import {
	AI_PROMPT_CONTRACT,
	buildAiAssetContext,
	buildAiOutputContract,
	buildAiProjectContext,
	buildAiReferenceContext,
	buildAiWorkflowRules,
	buildArtifactExtractionPrompt,
	buildDraftPromptFromExtractions,
	buildAiSystemInstruction,
	buildAiOverrideEvents,
	buildArtifactManifest,
	classifyAiFailure,
	collectAssetArtifacts,
	collectTextArtifacts,
	isAiCancelledError,
	summariseAiFailureMessage,
	normaliseDraftEstimateStructure,
	buildDraftEvidenceCoverage,
	normaliseAiTableSnapshot,
	parseDraftEstimateResponse,
	draftEstimateToEstimate,
	validateDraftEstimateRefs
} from './ai-drafting.js';
import {
	buildDraftCompositionPrompt,
	buildDraftMatchingPrompt,
	buildDraftOutlineFallbackPromptFromExtractions,
	buildDraftOutlinePromptFromExtractions
} from '$lib/contracts/ai-prompts.js';
import { buildAiEstimateContextSnapshot } from './estimate-ai-context.js';

vi.mock('./ai-file-evidence.js', async (importOriginal: () => Promise<unknown>) => {
	const original = (await importOriginal()) as typeof import('./ai-file-evidence.js');
	return {
		...original,
		prepareAndIndexFileChunks: vi.fn().mockResolvedValue(undefined)
	};
});

function createAssetFile(
	overrides: Partial<AssetFile> &
		Pick<AssetFile, 'id' | 'project_id' | 'file_path' | 'original_name'>
): AssetFile {
	return {
		asset_id: null,
		mime_type: null,
		created_at: '2026-03-16T00:00:00Z',
		...overrides
	};
}

function createEstimate(overrides: Partial<Estimate> = {}): Estimate {
	return {
		asset_id: 'asset-1',
		scope_summary: 'Base scope',
		notes: '',
		classification_system_id: null,
		wbs_root_node_id: null,
		applied_template_id: null,
		applied_template_name: null,
		takeoff_items: [],
		...overrides
	};
}

function createPreparedTextResult(params: {
	textContent: string;
	cacheHit?: boolean;
	sourceFormat?: AiTextArtifactSourceFormat;
	structureHints?: AiTextArtifactStructureHints | null;
}) {
	return {
		textContent: params.textContent,
		cacheHit: params.cacheHit ?? false,
		sourceFormat: params.sourceFormat ?? 'plain_text',
		structureHints: params.structureHints ?? null
	};
}

describe('ai drafting helpers', () => {
	it('pins the AI prompt contract versions for auditability', () => {
		expect(AI_PROMPT_CONTRACT).toEqual({
			systemInstructionVersion: 'local-system-v3-senior-estimator',
			extractionPromptVersion: 'local-extraction-v5-senior-estimator',
			draftPromptVersion: 'local-draft-v3-senior-estimator'
		});
	});

	it('builds extraction prompts from the run-owned prompt contract', () => {
		const prompt = buildArtifactExtractionPrompt(
			{
				projectContext: buildAiProjectContext({
					projectId: 'project-1',
					projectName: 'Factory upgrade',
					rfqNumber: 'RFQ-1001',
					content: 'Fabricate steel stairs.',
					note: 'Prefer workshop labour where possible.'
				}),
				assetContext: {
					assetId: 'asset-1',
					assetName: 'Main package',
					currentEstimateSeed: {
						scopeSummary: 'Base scope',
						notes: '',
						classificationSystemId: null,
						wbsRootNodeId: null,
						appliedTemplateId: null,
						appliedTemplateName: null,
						takeoffItemCount: 0,
						seededHeaderFields: [],
						hasExistingStructure: false
					},
					savedEstimateSeed: null
				},
				artifact: {
					kind: 'text',
					fileId: 'file-1',
					fileName: 'scope.txt',
					filePath: 'workspace/project-1/scope.txt',
					textContent: 'Scope text',
					sourceFormat: 'plain_text',
					structureHints: null
				},
				manifestEntry: {
					fileId: 'file-1',
					fileName: 'scope.txt',
					filePath: 'workspace/project-1/scope.txt',
					artifactKind: 'text',
					mimeType: 'text/plain',
					pageCount: null,
					renderCount: null,
					characterCount: 10,
					aiRole: 'plain_text_note',
					inclusionReason: 'Included as plain text asset context.',
					extractionMode: 'text_only',
					roleConfidence: 'medium',
					sourceFormat: 'plain_text',
					structureHints: null,
					evidenceIdentifiers: ['text:plain_text:chunk:1']
				}
			},
			{
				systemInstructionVersion: 'system-v9',
				extractionPromptVersion: 'extract-v9',
				draftPromptVersion: 'draft-v9'
			}
		);

		expect(prompt).toContain('Prompt version: extract-v9.');
		expect(prompt).not.toContain(AI_PROMPT_CONTRACT.extractionPromptVersion);
		expect(prompt).not.toContain('visualEvidence');
		expect(prompt).not.toContain('Factory upgrade');
		expect(prompt).not.toContain('RFQ-1001');
		expect(prompt).toContain('Never describe the model, prompt, request payload, schema');
		expect(prompt).toContain('senior estimator reviewing estimating evidence');
		expect(prompt).toContain('"summary": "string"');
		expect(prompt).toContain('"candidateItems"');
	});

	it('reduces project content into a structured RFQ brief for the relay payload', () => {
		const context = buildAiProjectContext({
			projectId: 'project-1',
			projectName: 'Factory upgrade',
			rfqNumber: 'RFQ-1001',
			content: `
Hello team,

Fabricate and install steel stairs to plant room.
Qty 2 stairs and 1 landing.
Use galvanised steel with anti-slip treads.
Refer drawing SK-102 revision B.
Exclude electrical works by others.

Kind regards,
Estimator
			`,
			note: 'Prefer workshop labour where possible.'
		});

		expect(context.rfqBrief).toMatchObject({
			scopeSummary: expect.stringContaining('Fabricate and install steel stairs'),
			quantitiesAndUnits: expect.stringContaining('Qty 2 stairs'),
			materialsAndSpecs: expect.stringContaining('galvanised steel'),
			referencedDocuments: expect.stringContaining('SK-102'),
			exclusions: expect.stringContaining('Exclude electrical works'),
			cleanedSourceText: expect.not.stringContaining('Kind regards')
		});
	});

	it('keeps the RFQ brief payload shape stable for relay prompting', () => {
		const context = buildAiProjectContext({
			projectId: 'project-1',
			projectName: 'Factory upgrade',
			rfqNumber: 'RFQ-1001',
			content: `
Hello team,

Fabricate and install galvanised steel platform and stair access.
Provide anti-slip grating to landing areas.
Qty 2 stairs and 1 platform.
Refer drawing SK-210 revision C and spec section 05 12 00.
Exclude electrical and handrail lighting by others.

Kind regards,
Estimator
			`,
			note: 'Prioritise workshop fabrication where practical.'
		});

		expect(context).toMatchInlineSnapshot(`
			{
			  "briefingSourceSummary": {
			    "hasEstimatorNote": true,
			    "hasRfqBrief": true,
			  },
			  "estimatorNote": "Prioritise workshop fabrication where practical.",
			  "projectId": "project-1",
			  "projectName": "Factory upgrade",
			  "rfqBrief": {
			    "cleanedSourceText": "Fabricate and install galvanised steel platform and stair access.
			Provide anti-slip grating to landing areas.
			Qty 2 stairs and 1 platform.
			Refer drawing SK-210 revision C and spec section 05 12 00.
			Exclude electrical and handrail lighting by others.",
			    "constraints": null,
			    "exclusions": "Exclude electrical and handrail lighting by others.",
			    "materialsAndSpecs": "Fabricate and install galvanised steel platform and stair access.
			Provide anti-slip grating to landing areas.
			Refer drawing SK-210 revision C and spec section 05 12 00.",
			    "quantitiesAndUnits": "Qty 2 stairs and 1 platform.",
			    "referencedDocuments": "Refer drawing SK-210 revision C and spec section 05 12 00.",
			    "scopeSummary": "Fabricate and install galvanised steel platform and stair access.
			Provide anti-slip grating to landing areas.",
			  },
			  "rfqContext": {
			    "addendumDate": null,
			    "addendumLabel": null,
			    "addendumNotes": null,
			    "customerTenderReference": null,
			    "deliveryAddress": null,
			    "estimatorName": null,
			    "receivedDate": null,
			    "siteAddress": null,
			    "submissionDeadlineAt": null,
			  },
			  "rfqNumber": "RFQ-1001",
			}
		`);
	});

	it('builds the draft prompt from the estimate context snapshot instead of only raw table payloads', () => {
		const estimateContextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				classificationSystems: [
					{
						id: 'class-1',
						code: 'STEEL',
						name: 'Steel',
						aliases: ['steel coding'],
						type: 'custom',
						is_default: true
					}
				],
				costCodes: [],
				wbsNodes: [],
				materialCatalogItems: [],
				labourRateCards: [],
				equipmentRateCards: [],
				subcontractRateCards: [],
				costComponentPresets: [],
				estimateTemplates: []
			},
			currentEstimate: createEstimate({
				scope_summary:
					'User seeded scope with a detailed canopy package description that should be compacted before it reaches the hosted outline prompt for reruns.',
				notes:
					'Pricing notes should stay helpful to the local editor, but the hosted outline prompt does not need the full internal commentary repeated verbatim when the user reruns AI on an already populated estimate.'
			})
		});

		const prompt = buildDraftPromptFromExtractions(
			{
				projectContext: buildAiProjectContext({
					projectId: 'project-1',
					projectName: 'Factory upgrade',
					rfqNumber: 'RFQ-1001',
					content: 'Fabricate steel stairs.',
					note: 'Prefer workshop labour where possible.'
				}),
				assetContext: buildAiAssetContext({
					assetId: 'asset-1',
					assetName: 'Main package',
					currentEstimate: createEstimate({ scope_summary: 'User seeded scope' }),
					contextSnapshot: estimateContextSnapshot
				}),
				referenceContext: buildAiReferenceContext(
					normaliseAiTableSnapshot({
						classificationSystems: [
							{ id: 'class-1', code: 'STEEL', name: 'Steel', type: 'custom', is_default: true }
						],
						costCodes: [],
						wbsNodes: [],
						materialCatalogItems: [],
						labourRateCards: [],
						equipmentRateCards: [],
						subcontractRateCards: [],
						costComponentPresets: [],
						estimateTemplates: []
					})
				),
				workflowRules: buildAiWorkflowRules(),
				outputContract: buildAiOutputContract(),
				estimateContextSnapshot,
				promptContract: AI_PROMPT_CONTRACT
			},
			[
				{
					fileId: 'file-1',
					fileName: 'spec.pdf',
					artifactKind: 'pdf',
					summary: 'Steel stairs with landing.',
					estimatingSignals: ['stairs'],
					candidateItems: [],
					issues: []
				}
			]
		);

		expect(prompt).toContain('"projectContext"');
		expect(prompt).toContain('"referenceContext"');
		expect(prompt).toContain('"estimateContext"');
		expect(prompt).toContain('"currentEstimateSummary"');
		expect(prompt).not.toContain('"currentEstimateState"');
		expect(prompt).not.toContain('"allowedUnits":[{');
		expect(prompt).toContain('"workflowRules"');
		expect(prompt).toContain('"scopeSummary"');
		expect(prompt).toContain('"materialsAndSpecs"');
		expect(prompt).toContain('unique strong match');
	});

	it('keeps the outline prompt on the compact estimate context contract', () => {
		const estimateContextSnapshot = buildAiEstimateContextSnapshot({
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade',
			tableSnapshot: {
				classificationSystems: [],
				costCodes: [],
				wbsNodes: [],
				materialCatalogItems: [],
				labourRateCards: [],
				equipmentRateCards: [],
				subcontractRateCards: [],
				costComponentPresets: [],
				estimateTemplates: []
			},
			currentEstimate: createEstimate({ scope_summary: 'User seeded scope' })
		});

		const params = {
			projectContext: buildAiProjectContext({
				projectId: 'project-1',
				projectName: 'Factory upgrade',
				rfqNumber: 'RFQ-1001',
				content: 'Fabricate steel stairs.',
				note: 'Prefer workshop labour where possible.'
			}),
			assetContext: buildAiAssetContext({
				assetId: 'asset-1',
				assetName: 'Main package',
				currentEstimate: createEstimate({
					scope_summary:
						'User seeded scope with a detailed canopy package description that should be compacted before it reaches the hosted outline prompt for reruns.',
					notes:
						'Pricing notes should stay helpful to the local editor, but the hosted outline prompt does not need the full internal commentary repeated verbatim when the user reruns AI on an already populated estimate.'
				}),
				contextSnapshot: estimateContextSnapshot
			}),
			referenceContext: buildAiReferenceContext(
				normaliseAiTableSnapshot({
					classificationSystems: [],
					costCodes: [],
					wbsNodes: [],
					materialCatalogItems: [],
					labourRateCards: [],
					equipmentRateCards: [],
					subcontractRateCards: [],
					costComponentPresets: [],
					estimateTemplates: []
				})
			),
			workspaceKnowledgeContext: {
				compiledMarkdown:
					'## Workspace Playbook\n\nBundle shop fabrication supply rows where evidence keeps the package together.',
				skillMarkdown:
					'# Workspace Estimating Skill\n\n## Business Playbook\n\nBundle shop fabrication supply rows where evidence keeps the package together.',
				skillHash: 'workspace-skill-hash-1',
				sourceSummary: {
					includedFileCount: 1,
					includedFeedbackCount: 1,
					learnedCorrectionCount: 2
				}
			},
			workflowRules: buildAiWorkflowRules(),
			outputContract: buildAiOutputContract(),
			estimateContextSnapshot,
			promptContract: AI_PROMPT_CONTRACT
		};

		const outlinePrompt = buildDraftOutlinePromptFromExtractions(params, [
			{
				fileId: 'file-1',
				fileName: 'spec.pdf',
				artifactKind: 'pdf',
				evidenceIdentifiers: ['pdf:text:pages:1-2', 'pdf:raster:page:1'],
				summary: 'Steel stairs with landing.',
				estimatingSignals: ['stairs'],
				candidateItems: [
					{
						label: 'Main stair stringers',
						quantityHint: '2',
						unitHint: 'ea',
						notes:
							'Use plate-cut stringers with welded cleats and preserve this very long explanation only in compact form.',
						evidenceRefs: [
							{
								file_id: 'file-1',
								file_name: 'spec.pdf',
								artifact_kind: 'pdf',
								page_number: 1,
								view_label: null,
								quote_path: 'page[1]',
								summary: 'Stringer note'
							}
						]
					}
				],
				issues: [
					{
						code: 'review_required',
						message: 'Need confirm landing bearing detail before final fabrication allowance.',
						severity: 'warning'
					}
				]
			}
		]);
		const matchingPrompt = buildDraftMatchingPrompt(params, {
			scopeSummary: 'Steel stairs',
			takeoffItems: []
		});
		const fallbackOutlinePrompt = buildDraftOutlineFallbackPromptFromExtractions(params, [
			{
				fileId: 'file-1',
				fileName: 'spec.pdf',
				artifactKind: 'pdf',
				evidenceIdentifiers: ['pdf:text:pages:1-2', 'pdf:raster:page:1'],
				summary: 'Steel stairs with landing.',
				estimatingSignals: ['stairs'],
				candidateItems: [
					{
						label: 'Main stair stringers',
						quantityHint: '2',
						unitHint: 'ea',
						notes: 'Fallback keeps only compact candidate context.'
					}
				],
				issues: [
					{
						code: 'review_required',
						message: 'Need confirm landing bearing detail before final fabrication allowance.',
						severity: 'warning'
					}
				]
			}
		]);
		const compositionPrompt = buildDraftCompositionPrompt(
			params,
			{
				scopeSummary: 'Steel stairs',
				takeoffItems: []
			},
			{
				takeoffItems: []
			}
		);

		expect(outlinePrompt).toContain('Stage: draft_outline.');
		expect(outlinePrompt).toContain('Return exactly one JSON object.');
		expect(outlinePrompt).toContain('Do not describe the model, prompt, or schema.');
		expect(outlinePrompt).toContain('"scope_summary": "string"');
		expect(outlinePrompt).toContain('"takeoff_items"');
		expect(outlinePrompt).toContain('## Workspace Skill');
		expect(outlinePrompt).toContain('Skill hash: workspace-skill-hash-1.');
		expect(outlinePrompt).toContain(
			'Skill sources: 1 knowledge file, 1 feedback note, 2 learned corrections.'
		);
		expect(outlinePrompt).toContain('# Workspace Estimating Skill');
		expect(outlinePrompt).toContain('Reference glossary: classification system');
		expect(outlinePrompt).toContain('later matching targets only');
		expect(outlinePrompt).toContain('"estimateContext"');
		expect(outlinePrompt).not.toContain('"currentEstimateState"');
		expect(outlinePrompt).not.toContain('"fieldSemantics"');
		expect(outlinePrompt).not.toContain('"allowedUnits":[{');
		expect(outlinePrompt).toContain(
			'"evidenceIdentifiers":["pdf:text:pages:1-2","pdf:raster:page:1"]'
		);
		expect(outlinePrompt).not.toContain('"evidenceRefs"');
		expect(outlinePrompt).not.toContain(
			'hosted outline prompt does not need the full internal commentary repeated verbatim'
		);
		expect(outlinePrompt).toContain('Pricing notes should stay helpful to the local editor');
		expect(outlinePrompt).toContain(
			'Do not create standalone takeoff items or cost rows from access constraints'
		);
		expect(outlinePrompt).toContain(
			'keep that information in notes, open questions, or review issues'
		);
		expect(fallbackOutlinePrompt).toContain('Stage: draft_outline_fallback.');
		expect(fallbackOutlinePrompt).toContain('## Workspace Skill');
		expect(fallbackOutlinePrompt).toContain('Reference glossary: classification system');
		expect(fallbackOutlinePrompt).toContain('later matching targets');
		expect(fallbackOutlinePrompt).toContain('reduced outline pass');
		expect(fallbackOutlinePrompt).toContain('Return exactly one JSON object.');
		expect(fallbackOutlinePrompt).toContain('Do not describe the model, prompt, or schema.');
		expect(fallbackOutlinePrompt).toContain('"scope_summary": "string"');
		expect(fallbackOutlinePrompt).toContain(
			'Do not turn access constraints, pricing preferences, or requested-output instructions into standalone takeoff items.'
		);
		expect(fallbackOutlinePrompt).toContain(
			'"evidenceIdentifiers":["pdf:text:pages:1-2","pdf:raster:page:1"]'
		);
		expect(fallbackOutlinePrompt).not.toContain('"workflowRules"');
		expect(fallbackOutlinePrompt).not.toContain('"fieldSemantics"');
		expect(fallbackOutlinePrompt).not.toContain('"fileId"');

		expect(matchingPrompt).toContain('Stage: draft_matching.');
		expect(matchingPrompt).toContain('## Workspace Skill');
		expect(matchingPrompt).toContain('"estimateContext"');
		expect(matchingPrompt).not.toContain('"currentEstimateState"');

		expect(compositionPrompt).toContain('Stage: draft_composition.');
		expect(compositionPrompt).toContain('## Workspace Skill');
		expect(compositionPrompt).toContain('"estimateContext"');
		expect(compositionPrompt).not.toContain('"currentEstimateState"');
	});

	it('builds system instructions from the run-owned prompt contract', () => {
		const instruction = buildAiSystemInstruction(
			{
				systemInstructionVersion: 'system-v9',
				extractionPromptVersion: 'extract-v9',
				draftPromptVersion: 'draft-v9'
			},
			'draft'
		);

		expect(instruction).toContain('Prompt contract: system-v9');
		expect(instruction).not.toContain(AI_PROMPT_CONTRACT.systemInstructionVersion);
	});

	it('pins the output contract to auto-apply into a working copy', () => {
		expect(buildAiOutputContract()).toMatchObject({
			returnShape: 'kwantflow_estimate_draft_v1',
			reviewExpectation: 'auto_apply_working_copy',
			unresolvedHandling: 'surface_in_issues_and_open_questions'
		});
	});

	it('recognises local AI cancellation errors separately from normal failures', () => {
		expect(
			isAiCancelledError(new Error('ai_failure_kind=cancelled; AI drafting was cancelled.'))
		).toBe(true);
		expect(isAiCancelledError(new Error('ai_failure_kind=native_runtime; failed'))).toBe(false);
	});

	it('normalises dynamic estimating tables into a compact AI-facing snapshot', () => {
		const snapshot = normaliseAiTableSnapshot({
			classificationSystems: [
				{
					id: 'classification-1',
					name: 'MasterFormat',
					code: 'MF',
					aliases: ['master format', 'steel codes'],
					type: 'cost-code',
					is_default: true,
					workspace_id: 'owner-1'
				}
			],
			costCodes: [
				{
					id: 'cost-code-1',
					classification_system_id: 'classification-1',
					parent_id: null,
					code: '05 12 00',
					name: 'Structural Steel Framing',
					description: 'Fabricated steel framing',
					is_active: true,
					sort_order: 0
				}
			],
			wbsNodes: [
				{
					id: 'wbs-root',
					parent_id: null,
					code: 'A',
					name: 'Area A',
					type: 'area',
					sort_order: 0
				},
				{
					id: 'wbs-child',
					parent_id: 'wbs-root',
					code: 'A1',
					name: 'Bay 1',
					type: 'zone',
					sort_order: 1
				}
			],
			materialCatalogItems: [
				{
					id: 'material-1',
					code: 'PL-6',
					name: 'Plate 6 mm',
					category: 'Plate',
					specification: 'AS/NZS mild steel',
					unit: 'ea',
					default_rate: 25,
					metadata: {
						aliases: ['6mm plate', 'plate six']
					},
					is_active: true,
					updated_at: 'noise'
				}
			],
			labourRateCards: [
				{
					id: 'labour-1',
					code: 'FAB',
					name: 'Fabrication',
					category: 'Shop',
					work_center: 'Workshop',
					unit: 'hr',
					default_rate: 95,
					metadata: {},
					is_active: true
				}
			],
			equipmentRateCards: [
				{
					id: 'equipment-1',
					code: 'CRANE',
					name: 'Crane',
					category: 'Lift',
					work_center: 'Yard',
					unit: 'hr',
					default_rate: 160,
					metadata: {},
					is_active: false
				}
			],
			costComponentPresets: [
				{
					id: 'preset-1',
					code: 'STD',
					name: 'Standard Plate',
					description: 'Plate + fab',
					is_active: true
				}
			],
			estimateTemplates: [
				{
					id: 'template-1',
					code: 'TEMP',
					name: 'Steel Template',
					description: 'Base steel estimate',
					is_active: true
				}
			]
		});

		expect(snapshot).toMatchObject({
			allowedUnits: expect.arrayContaining([
				expect.objectContaining({ code: 'ea', label: expect.any(String) }),
				expect.objectContaining({ code: 'hr', label: expect.any(String) })
			]),
			classificationSystems: [
				expect.objectContaining({
					id: 'classification-1',
					name: 'MasterFormat',
					code: 'MF',
					isDefault: true
				})
			],
			costCodes: [
				expect.objectContaining({
					id: 'cost-code-1',
					classificationSystemId: 'classification-1',
					code: '05 12 00',
					name: 'Structural Steel Framing',
					isActive: true
				})
			],
			wbsNodes: [
				expect.objectContaining({
					id: 'wbs-root',
					path: 'A Area A'
				}),
				expect.objectContaining({
					id: 'wbs-child',
					path: 'A Area A / A1 Bay 1'
				})
			],
			materialCatalogItems: [
				expect.objectContaining({
					id: 'material-1',
					aliases: ['6mm plate', 'plate six'],
					defaultRate: 25
				})
			]
		});
		const materialCatalogItems = snapshot.materialCatalogItems as Array<Record<string, unknown>>;
		expect(materialCatalogItems[0]).not.toHaveProperty('updated_at');
	});

	it('collects only text-like artifacts and surfaces unsupported files as issues', async () => {
		const files = [
			createAssetFile({
				id: 'file-text',
				project_id: 'project-1',
				file_path: 'workspace/project-1/spec.txt',
				original_name: 'spec.txt',
				mime_type: 'text/plain'
			}),
			createAssetFile({
				id: 'file-pdf',
				project_id: 'project-1',
				file_path: 'workspace/project-1/drawing.pdf',
				original_name: 'drawing.pdf',
				mime_type: 'application/pdf'
			})
		];

		const result = await collectTextArtifacts(files, async (file) => {
			if (file.id === 'file-text') {
				return 'Laser-cut mild steel plate, 4 pcs, 6 mm.';
			}
			throw new Error('unexpected read');
		});

		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]).toMatchObject({
			fileId: 'file-text',
			fileName: 'spec.txt',
			content: 'Laser-cut mild steel plate, 4 pcs, 6 mm.'
		});
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'unsupported_file',
					fileId: 'file-pdf'
				})
			])
		);
	});

	it('skips PDFs when preparation yields no text or raster evidence', async () => {
		const files = [
			createAssetFile({
				id: 'file-empty-pdf',
				project_id: 'project-1',
				file_path: 'workspace/project-1/empty.pdf',
				original_name: 'empty.pdf',
				mime_type: 'application/pdf'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async () => createPreparedTextResult({ textContent: '' }),
			readPdf: async () => ({
				pageCount: 1,
				text: '',
				rasterPages: [],
				cacheHit: true
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: 'image-data',
				cacheHit: false
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 0,
					faceCount: 0,
					edgeCount: 0,
					dimensions: null,
					format: 'step',
					previewMode: 'metadata_only',
					rootCount: null,
					transferCount: null,
					entityCount: null,
					renderCount: 0,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: 1024,
					viewLabels: [],
					reason: 'not_needed',
					sourceSummary: null
				},
				renders: [],
				summaryText: '',
				extractionMode: 'cad_metadata'
			})
		});

		expect(result.artifacts).toEqual([]);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'pdf_evidence_unavailable', fileId: 'file-empty-pdf' })
			])
		);
		expect(result.preprocessProfile.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fileId: 'file-empty-pdf',
					included: false,
					cacheHit: true,
					localSkipReason: 'pdf_evidence_unavailable'
				})
			])
		);
	});

	it('surfaces a warning issue when a text file is truncated due to size limit', async () => {
		const files = [
			createAssetFile({
				id: 'file-large-text',
				project_id: 'project-1',
				file_path: 'workspace/project-1/large.txt',
				original_name: 'large.txt',
				mime_type: 'text/plain'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async () => ({
				textContent: 'truncated text content',
				cacheHit: false,
				sourceFormat: 'plain_text',
				structureHints: null,
				isTruncated: true
			}),
			readPdf: async () => ({
				pageCount: 0,
				text: '',
				rasterPages: []
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: ''
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 0,
					faceCount: 0,
					edgeCount: 0,
					dimensions: null,
					format: 'step',
					previewMode: 'metadata_only',
					rootCount: null,
					transferCount: null,
					entityCount: null,
					renderCount: 0,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: 1024,
					viewLabels: [],
					reason: 'not_needed',
					sourceSummary: null
				},
				renders: [],
				summaryText: '',
				extractionMode: 'cad_metadata'
			})
		});

		expect(result.artifacts.length).toBe(1);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'text_file_truncated',
					fileId: 'file-large-text',
					severity: 'error'
				})
			])
		);
	});

	it('records canonical text chunk coordinates on every prepared part', async () => {
		const result = await collectAssetArtifacts(
			[
				createAssetFile({
					id: 'file-chunked-text',
					project_id: 'project-1',
					file_path: 'workspace/project-1/scope.txt',
					original_name: 'scope.txt',
					mime_type: 'text/plain'
				})
			],
			{
				readText: async () => ({
					textContent: 'part one\npart two',
					cacheHit: false,
					sourceFormat: 'plain_text',
					structureHints: null,
					chunks: [
						{ textContent: 'part one', structureHints: null },
						{ textContent: 'part two', structureHints: null }
					]
				}),
				readPdf: async () => ({ pageCount: 0, text: '', rasterPages: [] }),
				readImage: async () => ({ mimeType: 'image/webp', inlineData: '' }),
				readCad: async () => ({
					metadata: {
						vertexCount: 0,
						faceCount: 0,
						edgeCount: 0,
						dimensions: null,
						format: 'step',
						previewMode: 'metadata_only',
						rootCount: null,
						transferCount: null,
						entityCount: null,
						renderCount: 0,
						renderPolicyVersion: 'cad-render-v3',
						renderSize: 1024,
						viewLabels: [],
						reason: 'not_needed',
						sourceSummary: null
					},
					renders: [],
					summaryText: '',
					extractionMode: 'cad_metadata'
				})
			}
		);

		expect(result.artifacts).toEqual([
			expect.objectContaining({ sourceMetadata: { textChunk: { index: 1, total: 2 } } }),
			expect.objectContaining({ sourceMetadata: { textChunk: { index: 2, total: 2 } } })
		]);
	});

	it('collects each TIFF page as its own evidence artifact', async () => {
		const result = await collectAssetArtifacts(
			[
				createAssetFile({
					id: 'file-tiff',
					project_id: 'project-1',
					file_path: 'workspace/project-1/drawing.tiff',
					original_name: 'drawing.tiff',
					mime_type: 'image/tiff'
				})
			],
			{
				readText: async () => createPreparedTextResult({ textContent: '' }),
				readPdf: async () => ({ pageCount: 0, text: '', rasterPages: [] }),
				readImage: async () => ({
					mimeType: 'image/jpeg',
					inlineData: 'page-1',
					cacheHit: false,
					pages: [
						{ pageNumber: 1, mimeType: 'image/jpeg', inlineData: 'page-1' },
						{ pageNumber: 2, mimeType: 'image/jpeg', inlineData: 'page-2' }
					]
				}),
				readCad: async () => ({
					metadata: {
						vertexCount: 0,
						faceCount: 0,
						edgeCount: 0,
						dimensions: null,
						format: 'step',
						previewMode: 'metadata_only',
						rootCount: null,
						transferCount: null,
						entityCount: null,
						renderCount: 0,
						renderPolicyVersion: 'cad-render-v3',
						renderSize: 1024,
						viewLabels: [],
						reason: 'not_needed',
						sourceSummary: null
					},
					renders: [],
					summaryText: '',
					extractionMode: 'cad_metadata'
				})
			}
		);

		expect(result.artifacts).toEqual([
			expect.objectContaining({
				kind: 'image',
				fileName: 'drawing.tiff (Page 1 of 2)',
				inlineData: 'page-1',
				sourceMetadata: expect.objectContaining({ imagePage: { pageNumber: 1, total: 2 } })
			}),
			expect.objectContaining({
				kind: 'image',
				fileName: 'drawing.tiff (Page 2 of 2)',
				inlineData: 'page-2',
				sourceMetadata: expect.objectContaining({ imagePage: { pageNumber: 2, total: 2 } })
			})
		]);
	});

	it('collects multimodal artifacts for text, pdf, image, and cad inputs', async () => {
		const files = [
			createAssetFile({
				id: 'file-text',
				project_id: 'project-1',
				file_path: 'workspace/project-1/spec.txt',
				original_name: 'spec.txt',
				mime_type: 'text/plain'
			}),
			createAssetFile({
				id: 'file-pdf',
				project_id: 'project-1',
				file_path: 'workspace/project-1/rfq.pdf',
				original_name: 'rfq.pdf',
				mime_type: 'application/pdf'
			}),
			createAssetFile({
				id: 'file-image',
				project_id: 'project-1',
				file_path: 'workspace/project-1/site-photo.png',
				original_name: 'site-photo.png',
				mime_type: 'image/png'
			}),
			createAssetFile({
				id: 'file-cad',
				project_id: 'project-1',
				file_path: 'workspace/project-1/frame.step',
				original_name: 'frame.step',
				mime_type: 'application/step'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async (file) =>
				createPreparedTextResult({
					textContent: `TEXT:${file.original_name}`
				}),
			readPdf: async () => ({
				pageCount: 2,
				text: 'PDF RFQ CONTENT',
				cacheHit: true
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: 'image-data',
				cacheHit: false
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 12,
					faceCount: 6,
					edgeCount: 0,
					dimensions: { x: 100, y: 50, z: 25 },
					format: 'step',
					previewMode: 'mesh',
					rootCount: 2,
					transferCount: 2,
					entityCount: null,
					renderCount: 4,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: 1024,
					viewLabels: ['iso', 'front', 'top', 'side'],
					reason: null,
					sourceSummary: null
				},
				renders: [
					{ viewLabel: 'iso', mimeType: 'image/webp', data: 'iso-data' },
					{ viewLabel: 'front', mimeType: 'image/webp', data: 'front-data' },
					{ viewLabel: 'side', mimeType: 'image/webp', data: 'side-data' },
					{ viewLabel: 'top', mimeType: 'image/webp', data: 'top-data' }
				],
				summaryText: 'Previewable STEP CAD evidence ready for AI drafting.',
				extractionMode: 'cad_renders'
			})
		});

		expect(result.issues).toEqual([]);
		expect(result.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'text',
					fileId: 'file-text',
					textContent: 'TEXT:spec.txt'
				}),
				expect.objectContaining({
					kind: 'pdf',
					fileId: 'file-pdf',
					pageCount: 2,
					textContent: 'PDF RFQ CONTENT'
				}),
				expect.objectContaining({
					kind: 'image',
					fileId: 'file-image',
					mimeType: 'image/webp',
					inlineData: 'image-data'
				}),
				expect.objectContaining({
					kind: 'cad',
					fileId: 'file-cad',
					renders: expect.arrayContaining([
						expect.objectContaining({ viewLabel: 'iso' }),
						expect.objectContaining({ viewLabel: 'front' }),
						expect.objectContaining({ viewLabel: 'top' }),
						expect.objectContaining({ viewLabel: 'side' })
					]),
					metadata: expect.objectContaining({
						renderCount: 4,
						renderPolicyVersion: 'cad-render-v3',
						renderSize: 1024,
						viewLabels: ['iso', 'front', 'top', 'side']
					})
				})
			])
		);
		expect(result.preprocessProfile.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ fileId: 'file-text', cacheHit: false, localSkipReason: null }),
				expect.objectContaining({ fileId: 'file-pdf', cacheHit: true, localSkipReason: null }),
				expect.objectContaining({ fileId: 'file-image', cacheHit: false, localSkipReason: null }),
				expect.objectContaining({ fileId: 'file-cad', cacheHit: null, localSkipReason: null })
			])
		);
		const manifest = buildArtifactManifest(result.artifacts);
		expect(manifest).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fileId: 'file-text',
					evidenceIdentifiers: ['text:plain_text:chunk:1'],
					evidenceLocators: [
						expect.objectContaining({ kind: 'text_chunk', label: 'spec.txt text chunk 1' })
					],
					qualitySignals: expect.objectContaining({
						preparedEvidenceVersion: 'golden_v1',
						hasReadableText: true
					})
				}),
				expect.objectContaining({
					fileId: 'file-pdf',
					evidenceIdentifiers: ['pdf:text:pages:1-2'],
					evidenceLocators: [expect.objectContaining({ kind: 'pdf_text_pages', pageRange: '1-2' })],
					qualitySignals: expect.objectContaining({ hasReadableText: true, pageCount: 2 })
				}),
				expect.objectContaining({
					fileId: 'file-image',
					evidenceIdentifiers: ['image:raster:1'],
					evidenceLocators: [expect.objectContaining({ kind: 'image_raster' })],
					qualitySignals: expect.objectContaining({ hasRasterEvidence: true })
				}),
				expect.objectContaining({
					fileId: 'file-cad',
					evidenceIdentifiers: [
						'cad:metadata',
						'cad:render:iso',
						'cad:render:front',
						'cad:render:side',
						'cad:render:top'
					],
					evidenceLocators: expect.arrayContaining([
						expect.objectContaining({ kind: 'cad_metadata' }),
						expect.objectContaining({ kind: 'cad_render', viewLabel: 'iso' })
					]),
					qualitySignals: expect.objectContaining({ hasCadMetadata: true, hasRasterEvidence: true })
				})
			])
		);
	});

	it('skips low-signal operational text artifacts before local AI extraction', async () => {
		const files = [
			createAssetFile({
				id: 'file-log',
				project_id: 'project-1',
				file_path: 'workspace/project-1/sample-app.log',
				original_name: 'sample-app.log',
				mime_type: 'text/plain'
			}),
			createAssetFile({
				id: 'file-config',
				project_id: 'project-1',
				file_path: 'workspace/project-1/sample-config.json',
				original_name: 'sample-config.json',
				mime_type: 'application/json'
			}),
			createAssetFile({
				id: 'file-notes',
				project_id: 'project-1',
				file_path: 'workspace/project-1/sample-notes.txt',
				original_name: 'sample-notes.txt',
				mime_type: 'text/plain'
			}),
			createAssetFile({
				id: 'file-readme',
				project_id: 'project-1',
				file_path: 'workspace/project-1/README.md',
				original_name: 'README.md',
				mime_type: 'text/markdown'
			}),
			createAssetFile({
				id: 'file-sample-readme',
				project_id: 'project-1',
				file_path: 'workspace/project-1/sample-readme.md',
				original_name: 'sample-readme.md',
				mime_type: 'text/markdown'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async (file) =>
				createPreparedTextResult({
					textContent: `TEXT:${file.original_name}`
				}),
			readPdf: async () => ({
				pageCount: 0,
				text: '',
				cacheHit: false
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: 'unused-image-data',
				cacheHit: false
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 0,
					faceCount: 0,
					edgeCount: 0,
					dimensions: null,
					format: 'step',
					previewMode: 'metadata_only',
					rootCount: 0,
					transferCount: 0,
					entityCount: null,
					renderCount: 0,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: null,
					viewLabels: [],
					reason: 'not-used',
					sourceSummary: null
				},
				renders: [],
				summaryText: 'unused',
				extractionMode: 'cad_metadata'
			})
		});

		expect(result.artifacts).toEqual([
			expect.objectContaining({
				kind: 'text',
				fileId: 'file-notes',
				fileName: 'sample-notes.txt'
			}),
			expect.objectContaining({
				kind: 'text',
				fileId: 'file-sample-readme',
				fileName: 'sample-readme.md'
			})
		]);
		expect(result.preprocessProfile.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fileId: 'file-log',
					included: false,
					localSkipReason: 'low_signal_file_skipped'
				}),
				expect.objectContaining({
					fileId: 'file-config',
					included: false,
					localSkipReason: 'low_signal_file_skipped'
				}),
				expect.objectContaining({
					fileId: 'file-readme',
					included: false,
					localSkipReason: 'low_signal_file_skipped'
				})
			])
		);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'low_signal_file_skipped',
					fileId: 'file-log'
				}),
				expect.objectContaining({
					code: 'low_signal_file_skipped',
					fileId: 'file-config'
				}),
				expect.objectContaining({
					code: 'low_signal_file_skipped',
					fileId: 'file-readme'
				})
			])
		);
	});

	it('keeps metadata-only CAD as a usable cad artifact with summary text and no renders', async () => {
		const files = [
			createAssetFile({
				id: 'file-cad-meta',
				project_id: 'project-1',
				file_path: 'workspace/project-1/layout.step',
				original_name: 'layout.step',
				mime_type: 'application/step'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async () =>
				createPreparedTextResult({
					textContent: ''
				}),
			readPdf: async () => ({
				pageCount: 0,
				text: '',
				cacheHit: false
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: 'unused-image-data',
				cacheHit: false
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 0,
					faceCount: 0,
					edgeCount: 0,
					dimensions: null,
					format: 'step',
					previewMode: 'metadata_only',
					rootCount: 0,
					transferCount: 0,
					renderCount: 0,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: null,
					viewLabels: [],
					reason: 'STEP file contains no transferable roots',
					entityCount: null,
					sourceSummary: 'STEP content appears to contain placements or references only.'
				},
				renders: [],
				summaryText:
					'Valid STEP CAD file. No drawable geometry is available, so AI must reason from metadata only.',
				extractionMode: 'cad_metadata'
			})
		});

		expect(result.issues).toEqual([]);
		expect(result.artifacts).toEqual([
			expect.objectContaining({
				kind: 'cad',
				fileId: 'file-cad-meta',
				renders: [],
				summaryText:
					'Valid STEP CAD file. No drawable geometry is available, so AI must reason from metadata only.',
				metadata: expect.objectContaining({
					previewMode: 'metadata_only',
					renderPolicyVersion: 'cad-render-v3',
					renderSize: null,
					viewLabels: []
				})
			})
		]);
	});

	it('collects DXF through the shared cad evidence path once drawing evidence is supported', async () => {
		const files = [
			createAssetFile({
				id: 'file-dxf',
				project_id: 'project-1',
				file_path: 'workspace/project-1/layout.dxf',
				original_name: 'layout.dxf',
				mime_type: 'image/vnd.dxf'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async () =>
				createPreparedTextResult({
					textContent: ''
				}),
			readPdf: async () => ({
				pageCount: 0,
				text: '',
				cacheHit: false
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: 'unused-image-data',
				cacheHit: false
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 0,
					faceCount: 0,
					edgeCount: 12,
					dimensions: { x: 100, y: 50, z: 0 },
					format: 'dxf',
					previewMode: 'wire',
					rootCount: null,
					transferCount: null,
					renderCount: 1,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: 1536,
					viewLabels: ['drawing'],
					reason: null,
					entityCount: 12,
					sourceSummary: 'DXF linework converted into raster evidence.'
				},
				renders: [{ viewLabel: 'drawing', mimeType: 'image/webp', data: 'drawing-data' }],
				summaryText: 'DXF drawing evidence prepared for AI drafting.',
				extractionMode: 'cad_renders'
			})
		});

		expect(result.issues).toEqual([]);
		expect(result.artifacts).toEqual([
			expect.objectContaining({
				kind: 'cad',
				fileId: 'file-dxf',
				renders: [expect.objectContaining({ viewLabel: 'drawing' })],
				summaryText: 'DXF drawing evidence prepared for AI drafting.',
				metadata: expect.objectContaining({
					renderPolicyVersion: 'cad-render-v3',
					renderSize: 1536,
					viewLabels: ['drawing']
				})
			})
		]);
	});

	it('routes converted images and derived office files into usable AI artifacts', async () => {
		const files = [
			createAssetFile({
				id: 'file-svg',
				project_id: 'project-1',
				file_path: 'workspace/project-1/markup.svg',
				original_name: 'markup.svg',
				mime_type: 'image/svg+xml'
			}),
			createAssetFile({
				id: 'file-docx',
				project_id: 'project-1',
				file_path: 'workspace/project-1/spec.docx',
				original_name: 'spec.docx',
				mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			}),
			createAssetFile({
				id: 'file-xlsx',
				project_id: 'project-1',
				file_path: 'workspace/project-1/schedule.xlsx',
				original_name: 'schedule.xlsx',
				mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			})
		];

		const result = await collectAssetArtifacts(files, {
			readText: async (file) =>
				createPreparedTextResult({
					textContent: `TEXT:${file.original_name}`,
					sourceFormat: file.original_name.endsWith('.docx')
						? 'docx'
						: file.original_name.endsWith('.xlsx')
							? 'xlsx'
							: 'plain_text'
				}),
			readPdf: async () => ({
				pageCount: 0,
				text: '',
				cacheHit: false
			}),
			readImage: async () => ({
				mimeType: 'image/webp',
				inlineData: 'converted-image-data',
				cacheHit: true
			}),
			readCad: async () => ({
				metadata: {
					vertexCount: 0,
					faceCount: 0,
					edgeCount: 0,
					dimensions: null,
					format: 'step',
					previewMode: 'metadata_only',
					rootCount: 0,
					transferCount: 0,
					renderCount: 0,
					renderPolicyVersion: 'cad-render-v3',
					renderSize: null,
					viewLabels: [],
					reason: 'unused',
					entityCount: null,
					sourceSummary: null
				},
				renders: [],
				summaryText: 'unused',
				extractionMode: 'cad_metadata'
			})
		});

		expect(result.issues).toEqual([]);
		expect(result.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'image',
					fileId: 'file-svg',
					mimeType: 'image/webp',
					inlineData: 'converted-image-data'
				}),
				expect.objectContaining({
					kind: 'text',
					fileId: 'file-docx',
					textContent: 'TEXT:spec.docx'
				}),
				expect.objectContaining({
					kind: 'text',
					fileId: 'file-xlsx',
					textContent: 'TEXT:schedule.xlsx'
				})
			])
		);
	});

	it('downgrades invalid AI references into unresolved mappings and surfaced issues', () => {
		const validated = validateDraftEstimateRefs(
			{
				scope_summary: 'AI scope',
				notes: '',
				classification_system_id: 'missing-classification',
				wbs_root_node_id: 'missing-root',
				takeoff_items: [
					{
						name: 'Takeoff',
						description: '',
						quantity: 2,
						unit: 'ea',
						sort_order: 0,
						cost_code_id: 'missing-cost-code',
						wbs_node_id: 'missing-wbs',
						properties: {},
						evidence_refs: [],
						confidence: { overall: 0.7, extraction: 0.8, mapping: 0.1, quantity: 0.9 },
						open_questions: [],
						cost_components: [
							{
								category: 'material',
								source_type: 'material_catalog',
								source_id: 'missing-material',
								name: 'Plate',
								description: '',
								quantity: 2,
								unit: 'ea',
								unit_rate: 20,
								formula: {},
								metadata: {},
								sort_order: 0,
								evidence_refs: [],
								confidence: { overall: 0.6, extraction: 0.7, mapping: 0.1, quantity: 0.8 },
								mapping_status: 'matched'
							}
						]
					}
				],
				issues: []
			},
			{
				classificationSystemIds: new Set(['classification-1']),
				wbsNodeIds: new Set(['wbs-1']),
				costCodeIds: new Set(['cost-code-1']),
				materialSourceIds: new Set(['material-1']),
				labourSourceIds: new Set(['labour-1']),
				equipmentSourceIds: new Set(['equipment-1']),
				subcontractSourceIds: new Set(['subcontract-1'])
			}
		);

		expect(validated.draft.classification_system_id).toBeNull();
		expect(validated.draft.wbs_root_node_id).toBeNull();
		expect(validated.draft.takeoff_items[0]?.cost_code_id).toBeNull();
		expect(validated.draft.takeoff_items[0]?.wbs_node_id).toBeNull();
		expect(validated.draft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_id: null,
			mapping_status: 'unresolved'
		});
		expect(validated.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_classification_system' }),
				expect.objectContaining({ code: 'invalid_wbs_root' }),
				expect.objectContaining({ code: 'invalid_cost_code' }),
				expect.objectContaining({ code: 'invalid_wbs_node' }),
				expect.objectContaining({ code: 'invalid_material_source' })
			])
		);
	});

	it('rejects malformed draft payloads before they can be applied', () => {
		expect(() =>
			parseDraftEstimateResponse({
				scopeSummary: 123,
				takeoffItems: []
			})
		).toThrow();
	});

	it('accepts snake_case draft payloads and normalises loose issue entries', () => {
		const parsed = parseDraftEstimateResponse({
			scope_summary: 'AI scope',
			notes: 'Keep access after hours.',
			takeoff_items: [],
			issues: [
				'Check crane allowance',
				{
					kind: 'ambiguous_scope',
					detail: 'Confirm whether edge protection is included.',
					severity: 'review'
				}
			]
		});

		expect(parsed.scope_summary).toBe('AI scope');
		expect(parsed.notes).toBe('Keep access after hours.');
		expect(parsed.takeoff_items).toEqual([]);
		expect(parsed.issues).toEqual([
			{
				code: 'local_model_issue',
				message: 'Check crane allowance',
				severity: 'warning',
				fileId: null,
				fileName: null
			},
			{
				code: 'ambiguous_scope',
				message: 'Confirm whether edge protection is included.',
				severity: 'warning',
				fileId: null,
				fileName: null
			}
		]);
	});

	it('fills sparse local takeoff items into the minimum valid draft shape', () => {
		const parsed = parseDraftEstimateResponse({
			scope_summary: 'Canopy package',
			takeoff_items: [
				{
					name: 'Structural steel canopy',
					description: 'Main canopy frame',
					quantity: '1',
					unit: 'items'
				}
			]
		});

		expect(parsed.takeoff_items).toEqual([
			expect.objectContaining({
				name: 'Structural steel canopy',
				description: 'Main canopy frame',
				quantity: 1,
				unit: 'ea',
				sort_order: 0,
				properties: {},
				cost_components: [],
				evidence_refs: [],
				open_questions: [],
				confidence: {
					overall: 0.2,
					extraction: 0.4,
					mapping: 0.1,
					quantity: 0.2
				}
			})
		]);
	});

	it('captures override events when the saved estimate diverges from the applied AI draft', () => {
		const baseline = createEstimate({
			scope_summary: 'AI scope',
			takeoff_items: [
				{
					id: 'item-1',
					estimate_asset_id: 'asset-1',
					parent_id: null,
					wbs_node_id: null,
					cost_code_id: null,
					applied_preset_id: null,
					applied_preset_name: null,
					name: 'Plate',
					description: '',
					quantity: 4,
					unit: 'ea',
					properties: {},
					sort_order: 0,
					cost_components: []
				}
			]
		});
		const edited = createEstimate({
			scope_summary: 'Estimator scope',
			takeoff_items: [
				{
					...baseline.takeoff_items[0],
					quantity: 6
				}
			]
		});

		const overrides = buildAiOverrideEvents({
			runId: 'run-1',
			assetId: 'asset-1',
			baseline,
			current: edited
		});

		expect(overrides).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					run_id: 'run-1',
					asset_id: 'asset-1',
					field_path: 'scope_summary',
					original_value_json: JSON.stringify('AI scope'),
					final_value_json: JSON.stringify('Estimator scope')
				}),
				expect.objectContaining({
					field_path: 'takeoff_items[0].quantity',
					original_value_json: JSON.stringify(4),
					final_value_json: JSON.stringify(6)
				})
			])
		);
	});

	it('classifies persisted local AI failures into stable local kinds', () => {
		expect(classifyAiFailure('ai_failure_kind=timeout; Request timed out.')).toBe('timeout');
		expect(classifyAiFailure('Input exceeded the context window.')).toBe('context_limit');
		expect(
			classifyAiFailure(
				'The selected local AI runtime is no longer available. Reinstall the model before retrying.'
			)
		).toBe('model_unavailable');
		expect(classifyAiFailure('Native completion stream closed unexpectedly.')).toBe('interrupted');
	});

	it('summarises raw local validation dumps into stable user-facing failures', () => {
		const rawValidationDump = JSON.stringify([
			{
				code: 'invalid_value',
				path: ['result', 'runtimeExecutionContext', 'evidenceArtifacts', 0, 'fileId'],
				message: 'Invalid option'
			}
		]);

		expect(summariseAiFailureMessage(rawValidationDump, 'native_runtime')).toBe(
			'AI finished, but Kwantflow could not validate part of the local result. Rerun AI or update the app before trying again.'
		);
		expect(
			summariseAiFailureMessage(
				'ai_failure_kind=timeout; Local AI stopped responding before completion.',
				'timeout'
			)
		).toBe('AI took too long to finish this draft. You can rerun AI or keep estimating manually.');
	});

	it('preserves spatially distinct evidence refs from the same source text', () => {
		const evidenceBase = {
			file_id: 'file-1',
			file_name: 'drawing.png',
			artifact_kind: 'image' as const,
			quote_path: 'drawing.callout',
			summary: 'Bracket location'
		};
		const draft = normaliseDraftEstimateStructure({
			scope_summary: 'Two marked locations',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			takeoff_items: [
				{
					name: 'Bracket',
					description: 'Two locations',
					quantity: 2,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 },
					open_questions: [],
					cost_components: [],
					evidence_refs: [
						{
							...evidenceBase,
							evidence_identifier: 'drawing.location-a',
							locator: { x: 100, y: 200, width: 50, height: 50 }
						},
						{
							...evidenceBase,
							evidence_identifier: 'drawing.location-b',
							locator: { x: 700, y: 600, width: 50, height: 50 }
						}
					]
				}
			],
			issues: []
		});

		expect(draft.takeoff_items[0]?.evidence_refs).toHaveLength(2);
	});

	it('reports draft evidence and spatial locator coverage', () => {
		const coverage = buildDraftEvidenceCoverage({
			scope_summary: 'Coverage',
			notes: '',
			takeoff_items: [
				{
					name: 'Located item',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					properties: {},
					confidence: { overall: 1, extraction: 1, mapping: 1, quantity: 1 },
					open_questions: [],
					cost_components: [],
					evidence_refs: [
						{
							file_id: 'file-1',
							file_name: 'drawing.png',
							artifact_kind: 'image',
							locator: { x: 10, y: 20 },
							quote_path: 'drawing.item',
							summary: 'Located'
						}
					]
				},
				{
					name: 'Unlocated item',
					description: '',
					quantity: 1,
					unit: 'ea',
					sort_order: 1,
					properties: {},
					confidence: { overall: 1, extraction: 1, mapping: 1, quantity: 1 },
					open_questions: [],
					cost_components: [],
					evidence_refs: []
				}
			],
			issues: []
		});

		expect(coverage).toEqual({
			takeoffItemCount: 2,
			takeoffItemsWithEvidence: 1,
			takeoffItemsWithSpatialEvidence: 1,
			costComponentCount: 0,
			costComponentsWithEvidence: 0,
			costComponentsWithSpatialEvidence: 0
		});
	});

	it('merges adjacent AI takeoff items when they describe the same scoped work package', () => {
		const draft = normaliseDraftEstimateStructure({
			scope_summary: 'Fabricate and install access platform',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			takeoff_items: [
				{
					name: 'Access platform',
					description: 'Galvanised access platform',
					quantity: 1,
					unit: 'ea',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.7, quantity: 0.7 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Steel members',
							description: '',
							quantity: 1,
							unit: 'ea',
							unit_rate: 100,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.8, mapping: 0.7, quantity: 0.7 },
							mapping_status: 'unresolved'
						}
					]
				},
				{
					name: 'Access platform',
					description: 'Galvanised access platform',
					quantity: 1,
					unit: 'ea',
					sort_order: 1,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.6, extraction: 0.7, mapping: 0.6, quantity: 0.6 },
					open_questions: ['Confirm install access constraints.'],
					cost_components: [
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Workshop labour',
							description: '',
							quantity: 8,
							unit: 'hr',
							unit_rate: 0,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.6, extraction: 0.7, mapping: 0.6, quantity: 0.6 },
							mapping_status: 'unresolved'
						}
					]
				}
			],
			issues: []
		});

		expect(draft.takeoff_items).toHaveLength(1);
		expect(draft.takeoff_items[0]?.cost_components).toHaveLength(2);
		expect(draft.takeoff_items[0]?.open_questions).toEqual(['Confirm install access constraints.']);
	});

	it('defaults unmeasured AI takeoff item quantities to one during local normalisation', () => {
		const draft = normaliseDraftEstimateStructure({
			scope_summary: 'Fabricate and install access platform',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			takeoff_items: [
				{
					name: 'Access platform',
					description: 'Overall structural steel canopy package',
					quantity: 0,
					unit: 'lot',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.7, extraction: 0.8, mapping: 0.7, quantity: 0.2 },
					open_questions: ['Confirm measured quantity from drawing set.'],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Steel members',
							description: '',
							quantity: 1,
							unit: 'lot',
							unit_rate: 6200,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.7, extraction: 0.8, mapping: 0.4, quantity: 0.2 },
							mapping_status: 'unresolved'
						}
					]
				}
			],
			issues: []
		});

		expect(draft.takeoff_items[0]?.quantity).toBe(1);
		expect(draftEstimateToEstimate('asset-1', draft).takeoff_items[0]?.quantity).toBe(1);
	});

	it('collapses duplicated aggregate component quantities that repeat the takeoff measurement', () => {
		const draft = normaliseDraftEstimateStructure({
			scope_summary: 'Structural steel package',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			takeoff_items: [
				{
					name: '310UB40.4 beam supply',
					description: '',
					quantity: 54,
					unit: 'm',
					sort_order: 0,
					cost_code_id: null,
					wbs_node_id: null,
					properties: {},
					evidence_refs: [],
					confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 },
					open_questions: [],
					cost_components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: '310UB40.4',
							description: '',
							quantity: 54,
							unit: 'm',
							unit_rate: 185.5,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 },
							mapping_status: 'matched'
						}
					]
				}
			],
			issues: []
		});

		expect(draft.takeoff_items[0]?.quantity).toBe(54);
		expect(draft.takeoff_items[0]?.cost_components[0]?.quantity).toBe(1);
		expect(
			draftEstimateToEstimate('asset-1', draft).takeoff_items[0]?.cost_components[0]?.quantity
		).toBe(1);
	});

	it('preserves duplicated package-style quantities when the unit is count-like', () => {
		const draft = normaliseDraftEstimateStructure({
			scope_summary: 'Canopy package',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			takeoff_items: [
				{
					name: 'Canopy assembly',
					description: '',
					quantity: 2,
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
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Canopy assembly pack',
							description: '',
							quantity: 2,
							unit: 'ea',
							unit_rate: 1200,
							formula: {},
							metadata: {},
							sort_order: 0,
							evidence_refs: [],
							confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 },
							mapping_status: 'matched'
						}
					]
				}
			],
			issues: []
		});

		expect(draft.takeoff_items[0]?.cost_components[0]?.quantity).toBe(2);
	});

	it('surfaces zero or missing cost-row rates as review issues', () => {
		const { issues } = validateDraftEstimateRefs(
			{
				scope_summary: 'Platform',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: [
					{
						name: 'Access platform',
						description: '',
						quantity: 1,
						unit: 'ea',
						sort_order: 0,
						cost_code_id: null,
						wbs_node_id: null,
						properties: {},
						evidence_refs: [],
						confidence: { overall: 0.6, extraction: 0.6, mapping: 0.6, quantity: 0.6 },
						open_questions: [],
						cost_components: [
							{
								category: 'labour',
								source_type: 'manual',
								source_id: null,
								name: 'Install labour',
								description: '',
								quantity: 4,
								unit: 'hr',
								unit_rate: 0,
								formula: {},
								metadata: {},
								sort_order: 0,
								evidence_refs: [],
								confidence: { overall: 0.5, extraction: 0.5, mapping: 0.5, quantity: 0.5 },
								mapping_status: 'matched'
							}
						]
					}
				],
				issues: []
			},
			{
				classificationSystemIds: new Set(),
				wbsNodeIds: new Set(),
				costCodeIds: new Set(),
				materialSourceIds: new Set(),
				labourSourceIds: new Set(),
				equipmentSourceIds: new Set(),
				subcontractSourceIds: new Set()
			}
		);

		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'missing_component_rate',
					message: 'Install labour needs a rate review.'
				})
			])
		);
	});
});

it('summarises template and preset scaffolds before sending them to AI', () => {
	const referenceContext = buildAiReferenceContext(
		normaliseAiTableSnapshot({
			classificationSystems: [],
			costCodes: [],
			wbsNodes: [],
			materialCatalogItems: [],
			labourRateCards: [],
			equipmentRateCards: [],
			subcontractRateCards: [],
			costComponentPresets: [
				{
					id: 'preset-1',
					code: 'QA-PRESET-001',
					name: 'QA Canopy Install Scaffold',
					description:
						'Canopy install scaffold captured from live estimate editor for AI parity validation.',
					aliases: ['canopy starter'],
					is_active: true,
					components: [
						{
							category: 'material',
							source_type: 'manual',
							source_id: null,
							name: 'Structural Steel',
							description: 'Steel supply based on live reference evidence.',
							quantity: 1,
							unit: 'lot',
							unit_rate: 0,
							metadata: { ai_evidence_refs: [{ summary: 'Should stay local only' }] }
						},
						{
							category: 'labour',
							source_type: 'manual',
							source_id: null,
							name: 'Installation Labour',
							description: 'Installation labour allowance.',
							quantity: 14,
							unit: 'day',
							unit_rate: 0
						}
					]
				}
			],
			estimateTemplates: [
				{
					id: 'template-1',
					code: 'QA-TEMPLATE-001',
					name: 'QA Canopy Package',
					description:
						'Canopy package template captured from the live estimate editor for AI parity validation.',
					aliases: ['canopy package'],
					is_active: true,
					estimate: {
						scope_summary:
							'Structural Steel Canopy at Henderson Logistics, including steel framing and installation.',
						notes:
							'Long commercial note that should not be forwarded in full to the model because local application owns the full scaffold.',
						takeoff_items: [
							{
								name: 'Structural Steel Canopy',
								description: 'Fabrication and installation of the structural steel canopy.',
								quantity: 1,
								unit: 'job',
								applied_preset_name: 'QA Canopy Install Scaffold',
								cost_components: [
									{
										category: 'material',
										source_type: 'manual',
										name: 'Structural Steel',
										description: 'Steel supply'
									},
									{
										category: 'labour',
										source_type: 'manual',
										name: 'Installation Labour',
										description: 'Labour supply'
									}
								]
							}
						]
					}
				}
			]
		})
	);

	expect(referenceContext.draftingPatterns.costComponentPresets.records).toEqual([
		expect.objectContaining({
			id: 'preset-1',
			componentCount: 2,
			componentCategories: ['material', 'labour'],
			linkedSourceTypes: ['manual'],
			componentSummaries: [
				expect.objectContaining({
					category: 'material',
					name: 'Structural Steel',
					unit: 'lot',
					sourceType: 'manual'
				}),
				expect.objectContaining({
					category: 'labour',
					name: 'Installation Labour',
					unit: 'day',
					sourceType: 'manual'
				})
			]
		})
	]);
	expect(referenceContext.draftingPatterns.estimateTemplates.records).toEqual([
		expect.objectContaining({
			id: 'template-1',
			scopeSummary:
				'Structural Steel Canopy at Henderson Logistics, including steel framing and installation.',
			takeoffItemCount: 1,
			takeoffItems: [
				expect.objectContaining({
					name: 'Structural Steel Canopy',
					appliedPresetName: 'QA Canopy Install Scaffold',
					componentCategories: ['material', 'labour'],
					linkedSourceTypes: ['manual']
				})
			]
		})
	]);
	expect(
		JSON.stringify(referenceContext.draftingPatterns.estimateTemplates.records[0])
	).not.toContain('ai_evidence_refs');
	expect(
		JSON.stringify(referenceContext.draftingPatterns.costComponentPresets.records[0])
	).not.toContain('ai_evidence_refs');
	expect(referenceContext.draftingPatterns.estimateTemplates.records[0]).not.toHaveProperty(
		'estimate'
	);
	expect(referenceContext.draftingPatterns.costComponentPresets.records[0]).not.toHaveProperty(
		'components'
	);
});

it('keeps the active-only reference context shape stable for draft generation', () => {
	const referenceContext = buildAiReferenceContext(
		normaliseAiTableSnapshot({
			classificationSystems: [
				{
					id: 'classification-1',
					code: 'MF',
					name: 'MasterFormat',
					aliases: ['master format', 'steel codes'],
					type: 'cost-code',
					is_default: true
				}
			],
			costCodes: [
				{
					id: 'cost-code-active',
					classification_system_id: 'classification-1',
					parent_id: null,
					code: '05 12 00',
					name: 'Structural Steel Framing',
					description: 'Fabricated steel framing',
					is_active: true,
					sort_order: 0
				},
				{
					id: 'cost-code-inactive',
					classification_system_id: 'classification-1',
					parent_id: null,
					code: '05 50 00',
					name: 'Metal Fabrications',
					description: 'Inactive legacy code',
					is_active: false,
					sort_order: 1
				}
			],
			wbsNodes: [
				{ id: 'wbs-root', parent_id: null, code: 'A', name: 'Area A', type: 'area', sort_order: 0 }
			],
			materialCatalogItems: [
				{
					id: 'material-active',
					code: 'PL-6',
					name: 'Plate 6 mm',
					category: 'Plate',
					specification: 'AS/NZS mild steel',
					unit: 'ea',
					default_rate: 25,
					metadata: { aliases: ['6mm plate'] },
					is_active: true
				}
			],
			labourRateCards: [],
			equipmentRateCards: [],
			subcontractRateCards: [],
			costComponentPresets: [],
			estimateTemplates: []
		})
	);

	expect(referenceContext).toMatchInlineSnapshot(`
		{
		  "catalogueSources": {
		    "materials": {
		      "constraintLevel": "auto_link_source",
		      "howToUse": "Material catalogue rows are reusable priced material records. Link one when the evidence clearly identifies an existing material by code, name, alias, spec, or unit; otherwise keep a manual material row for review.",
		      "records": [
		        {
		          "aliases": [
		            "6mm plate",
		          ],
		          "availability": null,
		          "category": "Plate",
		          "code": "PL-6",
		          "defaultRate": 25,
		          "effectiveDate": null,
		          "id": "material-active",
		          "isActive": true,
		          "leadTime": null,
		          "metadata": {
		            "aliases": [
		              "6mm plate",
		            ],
		          },
		          "name": "Plate 6 mm",
		          "rateBasis": null,
		          "reference": null,
		          "specification": "AS/NZS mild steel",
		          "unit": "ea",
		          "verifiedDate": null,
		        },
		      ],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 1,
		    },
		  },
		  "draftingPatterns": {
		    "costComponentPresets": {
		      "constraintLevel": "structural_seed",
		      "howToUse": "Cost presets are reusable takeoff-item row packs. Apply one per takeoff item when the scoped work clearly matches an existing install/fabrication package, then keep extra linked or manual rows that the preset does not already cover.",
		      "records": [],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 0,
		    },
		    "estimateTemplates": {
		      "constraintLevel": "structural_seed",
		      "howToUse": "Estimate templates are reusable estimate-level starting structures. Use one only when the asset scope clearly matches an existing template pattern, then keep extra evidence-driven rows and notes that the template does not already cover.",
		      "records": [],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 0,
		    },
		  },
		  "mappingTargets": {
		    "classificationSystems": {
		      "constraintLevel": "hard_mapping",
		      "howToUse": "Classification systems group the cost-code taxonomy for the estimate header. Choose one only when the asset evidence clearly points to a known commercial coding system; otherwise leave the estimate classification blank.",
		      "records": [
		        {
		          "aliases": [
		            "master format",
		            "steel codes",
		          ],
		          "code": "MF",
		          "id": "classification-1",
		          "isActive": true,
		          "isDefault": true,
		          "name": "MasterFormat",
		          "type": "cost-code",
		        },
		      ],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 1,
		    },
		    "costCodes": {
		      "constraintLevel": "hard_mapping",
		      "howToUse": "Cost codes classify takeoff items inside the selected classification system. Use them only for commercial categorisation of the scoped work item; they do not replace the item name, quantities, or priced cost rows.",
		      "records": [
		        {
		          "classificationSystemId": "classification-1",
		          "code": "05 12 00",
		          "description": "Fabricated steel framing",
		          "id": "cost-code-active",
		          "isActive": true,
		          "name": "Structural Steel Framing",
		          "parentId": null,
		          "path": "05 12 00 Structural Steel Framing",
		        },
		      ],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 1,
		    },
		    "wbsNodes": {
		      "constraintLevel": "hard_mapping",
		      "howToUse": "Project structure roots and nodes anchor the estimate to the local work breakdown hierarchy. Use them only when the evidence clearly maps to an existing project structure path.",
		      "records": [
		        {
		          "code": "A",
		          "id": "wbs-root",
		          "name": "Area A",
		          "parentId": null,
		          "path": "A Area A",
		          "type": "area",
		        },
		      ],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 1,
		    },
		  },
		  "rateSources": {
		    "equipmentRates": {
		      "constraintLevel": "auto_link_source",
		      "howToUse": "Equipment rates are reusable plant and equipment pricing records. Link one when the evidence clearly matches an existing equipment type, alias, or hire basis; otherwise keep a manual equipment row for review.",
		      "records": [],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 0,
		    },
		    "labourRates": {
		      "constraintLevel": "auto_link_source",
		      "howToUse": "Labour rates are reusable labour pricing records. Link one only when the evidence clearly matches an existing labour role, crew, alias, work-centre, or unit; otherwise keep a manual labour row for review.",
		      "records": [],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 0,
		    },
		    "subcontractRates": {
		      "constraintLevel": "auto_link_source",
		      "howToUse": "Subcontract rates are reusable third-party trade or service pricing records. Link one when the evidence clearly matches an existing subcontract scope, alias, or rate basis; otherwise keep a manual subcontract row for review.",
		      "records": [],
		      "selectionBasis": "all_active",
		      "totalAvailableCount": 0,
		    },
		  },
		}
	`);
});
