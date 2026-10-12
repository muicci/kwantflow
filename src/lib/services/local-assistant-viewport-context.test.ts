import { describe, expect, it } from 'vitest';
import { buildLocalAssistantViewportContext } from './local-assistant-viewport-context.js';

describe('buildLocalAssistantViewportContext', () => {
	it('creates a Gemini-style sharing reference for any explicit page title', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/settings/materials',
			routeId: '/settings/materials',
			pageTitle: 'Materials',
			metadata: { catalogue: 'materials' }
		});

		expect(context.reference).toMatchObject({
			title: 'Materials',
			label: 'Sharing “Materials”',
			pathname: '/settings/materials',
			routeId: '/settings/materials'
		});
		expect(context.text).toContain('Current app page: Materials.');
		expect(context.text).toContain('Catalogue: materials.');
	});

	it('falls back to a readable title for unknown routes', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/admin/project-structure-templates/template-1',
			routeId: null
		});

		expect(context.pageTitle).toBe('Template 1');
		expect(context.reference.label).toBe('Sharing “Template 1”');
	});

	it('incorporates CAD metadata in the generated summary text', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/project/project-1/asset/asset-1',
			routeId: '/project/[id]/asset/[assetId]',
			pageTitle: 'Canopy Support CAD',
			cadMetadata: {
				format: 'dwg',
				dimensions: { x: 1200, y: 800, z: 150 },
				vertexCount: 1500,
				faceCount: 0,
				edgeCount: 1500,
				rootCount: 1,
				transferCount: 0,
				entityCount: 1500,
				sourceSummary: 'Custom Canopy Sheet',
				previewMode: 'wire'
			}
		});

		expect(context.cadMetadata).toMatchObject({
			format: 'dwg',
			vertexCount: 1500
		});
		expect(context.text).toContain('CAD Model Loaded:');
		expect(context.text).toContain('- Format: dwg');
		expect(context.text).toContain('- Dimensions: 1200mm x 800mm x 150mm');
		expect(context.text).toContain('- Vertices: 1,500');
		expect(context.text).toContain('- Description: Custom Canopy Sheet');
	});

	it('enriches viewport context with screen-specific route hints', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/contacts',
			routeId: '/contacts',
			pageTitle: 'Contacts'
		});

		expect(context.text).toContain('Screen context: This is the Contacts directory.');
		expect(context.text).toContain('Company and person contact list with search and filters.');
	});

	it('does not add screen context for unknown routes', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/unknown-page'
		});

		expect(context.text).not.toContain('Screen context:');
		expect(context.text).toContain('Current app page:');
	});

	it('includes screen hint for asset detail routes', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/asset/asset-1/preview/1',
			routeId: '/asset/[assetId]/preview/[fileId]',
			pageTitle: 'Steel Frame Takeoff'
		});

		expect(context.text).toContain('Screen context: This is the Asset detail.');
		expect(context.text).toContain(
			'Estimating bundle detail with takeoff items, files, and preview panes.'
		);
	});

	it('includes structured screen snapshot details when supplied', () => {
		const context = buildLocalAssistantViewportContext({
			pathname: '/project/project-1/quote',
			routeId: '/project/[id]/quote',
			pageTitle: 'Quote Workspace',
			metadata: { projectId: 'project-1', assetId: 'asset-1' },
			screen: {
				activeView: 'Option A',
				selectedRecordIds: ['takeoff-1', 'takeoff-2'],
				visibleRecords: [
					{ id: 'takeoff-1', label: 'Concrete slab', summary: '32MPa concrete at 42 m3' }
				],
				draftSummary: 'Quote option A has 4 takeoff items and one unresolved rate.',
				statusMessages: ['Unsaved changes', 'One item needs review']
			}
		});

		expect(context.screen).toMatchObject({
			activeView: 'Option A',
			selectedRecordIds: ['takeoff-1', 'takeoff-2']
		});
		expect(context.text).toContain('Active view: Option A.');
		expect(context.text).toContain('Selected records: takeoff-1, takeoff-2.');
		expect(context.text).toContain('Visible records: Concrete slab - 32MPa concrete at 42 m3.');
		expect(context.text).toContain('Draft state: Quote option A has 4 takeoff items');
		expect(context.text).toContain('Visible status: Unsaved changes; One item needs review.');
	});
});

describe('validateViewportAnswer', () => {
	it('accepts a valid viewport answer envelope', async () => {
		const { validateViewportAnswer } = await import('./local-assistant-viewport-context.js');

		const valid = {
			answer: 'I can see a contacts list with 3 companies.',
			observations: [
				{
					label: 'Company table',
					kind: 'data' as const,
					summary: 'A data table showing 3 company records with name and contact details.',
					confidence: 'high' as const
				}
			],
			uncertainty: 'The page title is partially cut off.',
			suggestedNextSteps: ['Click on a company to view details', 'Use the search box to filter'],
			citationIds: [],
			linkIds: [],
			imageSources: ['screenshot' as const]
		};

		const result = validateViewportAnswer(valid);
		expect(result.envelope).not.toBeNull();
		expect(result.envelope!.observations).toHaveLength(1);
		expect(result.envelope!.observations[0].label).toBe('Company table');
		expect(result.issues).toHaveLength(0);
	});

	it('rejects a missing answer field', async () => {
		const { validateViewportAnswer } = await import('./local-assistant-viewport-context.js');

		const invalid = { observations: [] };
		const result = validateViewportAnswer(invalid);
		expect(result.envelope).toBeNull();
		expect(result.issues.length).toBeGreaterThan(0);
		expect(result.issues.some((i) => i.includes('answer'))).toBe(true);
	});

	it('rejects observations exceeding max count', async () => {
		const { validateViewportAnswer } = await import('./local-assistant-viewport-context.js');

		const tooMany = {
			answer: 'test',
			observations: Array.from({ length: 7 }, (_, i) => ({
				label: `Item ${i}`,
				kind: 'element' as const,
				summary: 'test'
			}))
		};
		const result = validateViewportAnswer(tooMany);
		expect(result.envelope).toBeNull();
		expect(result.issues.length).toBeGreaterThan(0);
	});

	it('handles null/string input gracefully', async () => {
		const { validateViewportAnswer } = await import('./local-assistant-viewport-context.js');

		const result = validateViewportAnswer(null);
		expect(result.envelope).toBeNull();
		expect(result.issues.length).toBeGreaterThan(0);
	});
});
