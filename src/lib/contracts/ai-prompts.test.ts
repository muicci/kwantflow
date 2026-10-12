import { describe, it, expect } from 'vitest';
import {
	buildArtifactExtractionPrompt,
	buildAiSystemInstruction,
	buildDraftMatchingPrompt,
	buildDraftOutlinePromptFromExtractions,
	buildEmailIntakeSystemInstruction,
	buildSingleRecordExtractionSystemInstruction
} from './ai-prompts.js';

describe('AI Prompts Contracts', () => {
	describe('buildArtifactExtractionPrompt', () => {
		it('should generate extraction prompt using provided context and senior-estimator guardrails', () => {
			const prompt = buildArtifactExtractionPrompt(
				{
					projectContext: {
						projectName: 'Test Project',
						rfqNumber: 'RFQ-123',
						rfqBrief: 'Brief details',
						estimatorNote: 'Some note',
						rfqContext: { key: 'value' }
					},
					assetContext: {
						assetName: 'Test Asset'
					},
					artifactContext: {
						fileName: 'test_file.pdf',
						fileType: 'application/pdf'
					}
				},
				{
					extractionPromptVersion: '1.0'
				}
			);

			expect(prompt).toContain('Prompt version: 1.0.');
			expect(prompt).toContain(
				'senior estimator reviewing estimating evidence from "test_file.pdf"'
			);
			expect(prompt).toContain('full read-access for this run');
			expect(prompt).toContain('Never invent certainty, mappings, quantities');
			expect(prompt).not.toContain('RFQ brief guide:');
			expect(prompt).toContain('Required response shape:');

			// Extract the JSON payload at the end of the prompt
			const promptParts = prompt.split('\n\n');
			const jsonPayload = promptParts[promptParts.length - 1];

			// Verify it parses as valid JSON
			const parsed = JSON.parse(jsonPayload);
			expect(parsed.projectContext.projectName).toBe('Test Project');
			expect(parsed.projectContext.rfqNumber).toBe('RFQ-123');
			expect(parsed.projectContext.rfqBrief).toBe('Brief details');
			expect(parsed.projectContext.estimatorNote).toBe('Some note');
			expect(parsed.projectContext.rfqContext).toEqual({ key: 'value' });
			expect(parsed.assetContext.assetName).toBe('Test Asset');
			expect(parsed.artifactContext.fileName).toBe('test_file.pdf');
			expect(parsed.artifactContext.fileType).toBe('application/pdf');
		});

		it('should handle null/undefined optional values gracefully', () => {
			const prompt = buildArtifactExtractionPrompt(
				{
					projectContext: {
						projectName: null,
						rfqNumber: null,
						rfqBrief: null
						// estimatorNote and rfqContext omitted
					},
					assetContext: {
						assetName: 'Unknown Asset'
					},
					artifactContext: {} // fileName omitted
				},
				{
					extractionPromptVersion: '1.1'
				}
			);

			expect(prompt).toContain('Prompt version: 1.1.');
			expect(prompt).toContain(
				'senior estimator reviewing estimating evidence from "this artifact"'
			);

			// Extract the JSON payload at the end of the prompt
			const promptParts = prompt.split('\n\n');
			const jsonPayload = promptParts[promptParts.length - 1];

			// Verify it parses as valid JSON
			const parsed = JSON.parse(jsonPayload);
			expect(parsed.projectContext.projectName).toBeNull();
			expect(parsed.projectContext.rfqNumber).toBeNull();
			expect(parsed.projectContext.rfqBrief).toBeNull();
			expect(parsed.projectContext.estimatorNote).toBeUndefined();
			expect(parsed.projectContext.rfqContext).toBeUndefined();
			expect(parsed.assetContext.assetName).toBe('Unknown Asset');
			expect(parsed.artifactContext.fileName).toBeUndefined();
		});
	});

	describe('buildAiSystemInstruction', () => {
		it('should generate system instruction for extraction stage', () => {
			const prompt = buildAiSystemInstruction(
				{
					systemInstructionVersion: '2.0'
				},
				'extraction'
			);

			expect(prompt).toContain('Prompt contract: 2.0');
			expect(prompt).toContain("Kwantflow's Senior Estimator");
			expect(prompt).toContain('full read-access for this run');
			expect(prompt).toContain('Senior estimator reasoning checklist');
			expect(prompt).toContain('Evidence quality: how complete');
			expect(prompt).toContain(
				'Extract evidence only. Do not draft the full estimate in this stage.'
			);
			expect(prompt).not.toContain('Workspace playbook guidance may shape estimating judgement');
		});

		it('should generate system instruction for draft stage', () => {
			const prompt = buildAiSystemInstruction(
				{
					systemInstructionVersion: '2.1'
				},
				'draft'
			);

			expect(prompt).toContain('Prompt contract: 2.1');
			expect(prompt).toContain("Kwantflow's Senior Estimator");
			expect(prompt).toContain('Commercial realism: do category, source type');
			expect(prompt).toContain('Workspace playbook guidance may shape estimating judgement');
			expect(prompt).not.toContain(
				'Extract evidence only. Do not draft the full estimate in this stage.'
			);
		});
	});

	describe('draft stage prompt guidance', () => {
		const baseParams = {
			projectContext: { projectName: 'Factory upgrade' },
			assetContext: { assetName: 'Canopy package' },
			workspaceKnowledgeContext: null,
			referenceContext: {},
			workflowRules: {},
			outputContract: {},
			estimateContextSnapshot: {
				schema: {
					headerFields: [],
					takeoffItemFields: [],
					costComponentFields: [],
					allowedCategories: [],
					allowedUnitsByCategory: {}
				},
				field_semantics: {},
				current_estimate_state: {}
			},
			promptContract: { draftPromptVersion: 'draft-v3' }
		};

		it('includes stage identification and confidence guidance in outline prompts', () => {
			const prompt = buildDraftOutlinePromptFromExtractions(baseParams, []);

			expect(prompt).toContain('Stage: draft_outline.');
			expect(prompt).toContain('Confidence values must be numbers from 0.0 to 1.0');
			expect(prompt).not.toContain('ROM/order-of-magnitude');
			expect(prompt).not.toContain('Estimate schema overview');
		});

		it('uses explicit matching response guidance and no-matching-record rules', () => {
			const prompt = buildDraftMatchingPrompt(baseParams, { takeoff_items: [] });

			expect(prompt).toContain('Stage: draft_matching.');
			expect(prompt).toContain('Reference tables provided: classificationSystems');
			expect(prompt).toContain('mapping_status manual');
			expect(prompt).toContain('code no_matching_record');
			expect(prompt).toContain('Required response shape:');
			expect(prompt).toContain('no_matching_record');
		});
	});

	describe('buildEmailIntakeSystemInstruction', () => {
		it('should generate system instruction containing expected sections and conflict resolution details', () => {
			const prompt = buildEmailIntakeSystemInstruction();
			expect(prompt).toContain('<|think|>');
			expect(prompt).toContain('=== CONTACT INFO (from email body/signature) ===');
			expect(prompt).toContain('=== RFQ/PROJECT DETAILS ===');
			expect(prompt).toContain('=== ADDRESSES ===');
			expect(prompt).toContain('=== ADDENDA');
			expect(prompt).toContain('=== CONFLICT RESOLUTION ===');
			expect(prompt).toContain('use_smtp_contact');
			expect(prompt).toContain('Return valid JSON only. No markdown, no commentary.');
		});
	});

	describe('buildSingleRecordExtractionSystemInstruction', () => {
		it('should generate standard extraction prompt instruction when isRetry is false or omitted', () => {
			const prompt = buildSingleRecordExtractionSystemInstruction('Material');
			expect(prompt).toBe(
				'<|think|>\nExtract exactly one material record from the user request below.'
			);
		});

		it('should generate retry instruction requiring tool call when isRetry is true', () => {
			const prompt = buildSingleRecordExtractionSystemInstruction('Labour Rate Card', true);
			expect(prompt).toBe(
				'<|think|>\nREQUIRED: Extract exactly one labour rate card record. You MUST call the tool.'
			);
		});
	});
});
