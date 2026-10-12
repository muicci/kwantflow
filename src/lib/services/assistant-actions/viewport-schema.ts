import { z } from 'zod';

/**
 * Structured viewport observation for when the assistant receives a page screenshot.
 * This is the model-facing contract — the model describes what it sees, and the app
 * validates that the answer is structurally sound before displaying it to the user.
 */
export const ViewportObservationSchema = z.object({
	label: z.string().trim().min(1).max(80),
	kind: z.enum(['element', 'data', 'navigation', 'action', 'text', 'status']),
	summary: z.string().trim().min(1).max(320),
	confidence: z.enum(['low', 'medium', 'high']).default('medium'),
	positionHint: z.string().trim().max(120).optional()
});

export const ViewportAnswerEnvelopeSchema = z.object({
	answer: z.string().trim().min(1),
	observations: z.array(ViewportObservationSchema).max(6).default([]),
	uncertainty: z.string().trim().max(200).optional(),
	suggestedNextSteps: z.array(z.string().trim().min(1)).max(3).default([]),
	citationIds: z.array(z.string()).default([]),
	linkIds: z.array(z.string()).default([]),
	imageSources: z.array(z.literal('screenshot')).default([])
});

export type ViewportObservation = z.infer<typeof ViewportObservationSchema>;
export type ViewportAnswerEnvelope = z.infer<typeof ViewportAnswerEnvelopeSchema>;

/**
 * Mapping of known route patterns to descriptive screen identifiers.
 * Used to generate page-specific context hints and test fixtures.
 */
export const SCREEN_ROUTE_HINTS: Record<string, { label: string; description: string }> = {
	'/project': {
		label: 'RFQ / Projects list',
		description: 'List of all RFQ workspaces with status and metadata.'
	},
	'/project/': {
		label: 'RFQ dashboard',
		description: 'Individual RFQ workspace overview with files, contacts, and assets.'
	},
	'/asset/': {
		label: 'Asset detail',
		description: 'Estimating bundle detail with takeoff items, files, and preview panes.'
	},
	'/preview/': {
		label: 'File preview',
		description: 'Full-screen file or CAD preview with annotation/measurement tools.'
	},
	'/contacts': {
		label: 'Contacts directory',
		description: 'Company and person contact list with search and filters.'
	},
	'/materials': {
		label: 'Materials catalogue',
		description: 'Material catalogue with rates, units, categories, and search.'
	},
	'/labour-rates': {
		label: 'Labour rate cards',
		description: 'Labour rate-card table with roles, rates, and categories.'
	},
	'/equipment-rates': {
		label: 'Equipment rate cards',
		description: 'Equipment rate-card table with equipment types and rates.'
	},
	'/subcontract-rates': {
		label: 'Subcontract rate cards',
		description: 'Subcontractor rate-card table with trades and rates.'
	},
	'/classification-systems': {
		label: 'Classification systems',
		description: 'Classification system and cost code hierarchy editor.'
	},
	'/templates': {
		label: 'Templates',
		description: 'Estimate and project structure template library.'
	},
	'/quote': {
		label: 'Quote workspace',
		description: 'Quote revision workspace with options, summary, and proposal sections.'
	},
	'/settings': {
		label: 'Settings',
		description: 'App and workspace settings with profile, localisation, and AI preferences.'
	},
	'/setup-import': {
		label: 'Setup import',
		description: 'Bulk import page for contacts, materials, and rate cards.'
	}
};

export function resolveScreenHint(pathname: string): { label: string; description: string } | null {
	// Sort by longest prefix first so more specific routes match before generic ones
	const entries = Object.entries(SCREEN_ROUTE_HINTS).sort((a, b) => b[0].length - a[0].length);
	for (const [prefix, hint] of entries) {
		if (pathname.startsWith(prefix)) return hint;
	}
	return null;
}
