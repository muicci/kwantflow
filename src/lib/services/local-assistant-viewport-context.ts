import {
	ViewportAnswerEnvelopeSchema,
	resolveScreenHint,
	type ViewportAnswerEnvelope,
	type ViewportObservation,
	SCREEN_ROUTE_HINTS
} from './assistant-actions/viewport-schema.js';

export {
	ViewportAnswerEnvelopeSchema,
	SCREEN_ROUTE_HINTS,
	type ViewportAnswerEnvelope,
	type ViewportObservation
};

export interface LocalAssistantPageReference {
	title: string;
	label: string;
	pathname: string;
	routeId: string | null;
}

export interface LocalAssistantViewportContext {
	id: string;
	pathname: string;
	routeId: string | null;
	pageTitle: string;
	reference: LocalAssistantPageReference;
	metadata: Record<string, string | number | boolean | null | undefined>;
	screen?: LocalAssistantScreenSnapshot;
	text: string;
	cadMetadata?: import('./cad-loader.js').CadMetadata | null;
}

const PAGE_CONTEXT_TEXT_LIMIT = 900;
const SCREEN_RECORD_LIMIT = 5;

export interface LocalAssistantVisibleRecordSummary {
	id?: string | null;
	label: string;
	summary?: string | null;
}

export interface LocalAssistantScreenSnapshot {
	activeView?: string | null;
	selectedRecordIds?: string[];
	visibleRecords?: LocalAssistantVisibleRecordSummary[];
	draftSummary?: string | null;
	statusMessages?: string[];
}

function normaliseWhitespace(value: string | null | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

function humaniseSegment(value: string): string {
	return value
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (letter) => letter.toUpperCase())
		.trim();
}

function trimTitle(value: string, maxLength = 64): string {
	const text = normaliseWhitespace(value);
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function titleFromPathname(pathname: string): string {
	const path = pathname.split('?')[0]?.split('#')[0] ?? pathname;
	const segments = path.split('/').filter(Boolean);
	if (segments.length === 0) return 'Home';

	const lastReadable = [...segments]
		.reverse()
		.find((segment) => !/^[0-9a-f-]{8,}$/i.test(segment) && !/^\[.+\]$/.test(segment));
	return humaniseSegment(lastReadable ?? segments.at(-1) ?? 'Current page') || 'Current page';
}

function buildSummary(params: {
	pageTitle: string;
	pathname: string;
	routeId: string | null;
	metadata?: Record<string, string | number | boolean | null | undefined>;
	screen?: LocalAssistantScreenSnapshot | null;
	cadMetadata?: import('./cad-loader.js').CadMetadata | null;
}): string {
	const metadataLines = Object.entries(params.metadata ?? {})
		.filter(([, value]) => value !== null && value !== undefined && `${value}`.trim().length > 0)
		.map(([key, value]) => `${humaniseSegment(key)}: ${value}.`);

	const cadLines: string[] = [];
	if (params.cadMetadata) {
		const cmd = params.cadMetadata;
		cadLines.push('CAD Model Loaded:');
		cadLines.push(`- Format: ${cmd.format}`);
		if (cmd.dimensions) {
			cadLines.push(
				`- Dimensions: ${cmd.dimensions.x}mm x ${cmd.dimensions.y}mm x ${cmd.dimensions.z}mm`
			);
		}
		cadLines.push(`- Vertices: ${cmd.vertexCount.toLocaleString()}`);
		cadLines.push(`- Faces: ${cmd.faceCount.toLocaleString()}`);
		cadLines.push(`- Edges: ${cmd.edgeCount.toLocaleString()}`);
		if (cmd.sourceSummary) {
			cadLines.push(`- Description: ${cmd.sourceSummary}`);
		}
	}

	const screenHint = resolveScreenHint(params.pathname);
	const screenContextLines: string[] = [];
	if (screenHint) {
		screenContextLines.push(
			`Screen context: This is the ${screenHint.label}. ${screenHint.description}`
		);
	}

	const screenLines: string[] = [];
	if (params.screen?.activeView) {
		screenLines.push(`Active view: ${normaliseWhitespace(params.screen.activeView)}.`);
	}
	const selectedRecordIds = (params.screen?.selectedRecordIds ?? [])
		.map((id) => normaliseWhitespace(id))
		.filter(Boolean)
		.slice(0, SCREEN_RECORD_LIMIT);
	if (selectedRecordIds.length > 0) {
		screenLines.push(`Selected records: ${selectedRecordIds.join(', ')}.`);
	}
	const visibleRecords = (params.screen?.visibleRecords ?? [])
		.map((record) => {
			const label = normaliseWhitespace(record.label);
			if (!label) return null;
			const summary = normaliseWhitespace(record.summary);
			return summary ? `${label} - ${summary}` : label;
		})
		.filter((entry): entry is string => Boolean(entry))
		.slice(0, SCREEN_RECORD_LIMIT);
	if (visibleRecords.length > 0) {
		screenLines.push(`Visible records: ${visibleRecords.join('; ')}.`);
	}
	if (params.screen?.draftSummary) {
		screenLines.push(`Draft state: ${normaliseWhitespace(params.screen.draftSummary)}.`);
	}
	const statusMessages = (params.screen?.statusMessages ?? [])
		.map((message) => normaliseWhitespace(message))
		.filter(Boolean)
		.slice(0, SCREEN_RECORD_LIMIT);
	if (statusMessages.length > 0) {
		screenLines.push(`Visible status: ${statusMessages.join('; ')}.`);
	}

	return [
		`Current app page: ${params.pageTitle}.`,
		`Path: ${params.pathname}.`,
		...screenContextLines,
		...screenLines,
		...metadataLines,
		...cadLines
	]
		.join('\n')
		.slice(0, PAGE_CONTEXT_TEXT_LIMIT);
}

export function buildLocalAssistantViewportContext(params: {
	pathname: string;
	routeId?: string | null;
	pageTitle?: string | null;
	metadata?: Record<string, string | number | boolean | null | undefined>;
	text?: string | null;
	screen?: LocalAssistantScreenSnapshot | null;
	cadMetadata?: import('./cad-loader.js').CadMetadata | null;
}): LocalAssistantViewportContext {
	const pathname = params.pathname || '/';
	const pageTitle = trimTitle(params.pageTitle || titleFromPathname(pathname));
	const routeId = params.routeId ?? null;
	const text = normaliseWhitespace(params.text);
	const reference: LocalAssistantPageReference = {
		title: pageTitle,
		label: `Sharing “${pageTitle}”`,
		pathname,
		routeId
	};

	return {
		id: `page:${routeId ?? pathname}`,
		pathname,
		routeId,
		pageTitle,
		reference,
		metadata: params.metadata ?? {},
		screen: params.screen ?? undefined,
		cadMetadata: params.cadMetadata ?? null,
		text: text
			? text.slice(0, PAGE_CONTEXT_TEXT_LIMIT)
			: buildSummary({
					pageTitle,
					pathname,
					routeId,
					metadata: params.metadata,
					screen: params.screen,
					cadMetadata: params.cadMetadata
				})
	};
}

/**
 * Validates the model's screenshot-based answer against the ViewportAnswerEnvelope schema.
 * Returns the parsed and validated envelope, or null with issues if validation fails.
 * Use this when a screenshot was attached to the assistant turn and the model
 * responded with observations about what it sees.
 */
export function validateViewportAnswer(content: unknown): {
	envelope: ViewportAnswerEnvelope | null;
	issues: string[];
} {
	const result = ViewportAnswerEnvelopeSchema.safeParse(content);
	if (result.success) {
		return { envelope: result.data, issues: [] };
	}
	const issues: string[] = [];
	for (const issue of result.error.issues) {
		issues.push(`${issue.path.join('.')}: ${issue.message}`);
	}
	return { envelope: null, issues };
}
