import type { AppShellHref } from '$lib/utils/app-shell-href.js';
import {
	getProjectCompanyDisplayName,
	getProjectRequesterDisplayName
} from '$lib/utils/project-contact.js';
import { dbService } from '$lib/services/db.js';
import { getLocalAssistantHelpSections } from '$lib/services/local-assistant-help.js';
import { createLogger } from '$lib/services/logger.js';

const log = createLogger('localAssistantContext');
import { WORKSPACE_RUNTIME_SCHEMA } from '$lib/services/db-schema-health.js';
import type { LocalAssistantViewportContext } from '$lib/services/local-assistant-viewport-context.js';
import type {
	AiWorkspaceKnowledgeContext,
	LocalAssistantContextSection,
	LocalAssistantEstimateContext,
	WorkspaceProfile
} from '$lib/types/index.js';

type LocalAssistantContextRequest = {
	pathname: string;
	projectId: string | null;
	assetId: string | null;
	workspaceProfile: WorkspaceProfile | null;
	knowledgeContext: AiWorkspaceKnowledgeContext | null;
	currentEstimateContext: LocalAssistantEstimateContext | null;
	viewportContext: LocalAssistantViewportContext | null;
	query?: string;
};

const MAX_SECTION_TEXT_CHARS = 1_200;
const MAX_QUERY_SECTION_COUNT = 8;

function normaliseText(value: string | null | undefined): string {
	return (value ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function clampText(value: string, maxLength = MAX_SECTION_TEXT_CHARS): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildKeywords(...values: Array<string | null | undefined>): string[] {
	const tokens = values
		.flatMap((value) =>
			(value ?? '')
				.toLowerCase()
				.split(/[^a-z0-9]+/i)
				.filter((token) => token.length > 1)
		)
		.filter(Boolean);
	return [...new Set(tokens)];
}

function excerpt(value: string | null | undefined, maxLength = 220): string {
	const text = normaliseText(value);
	if (!text) return '';
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function asRoute(route: string | null): AppShellHref | null {
	if (!route?.startsWith('/')) return null;
	return route as AppShellHref;
}

function pushSection(
	sections: LocalAssistantContextSection[],
	section: LocalAssistantContextSection | null
): void {
	if (!section) return;
	if (!section.text.trim()) return;
	sections.push({
		...section,
		text: clampText(normaliseText(section.text)),
		summary: excerpt(section.summary || section.text, 180),
		keywords: [...new Set(section.keywords)]
	});
}

function scoreSection(
	section: LocalAssistantContextSection,
	queryTokens: string[],
	pathname: string,
	projectId: string | null,
	assetId: string | null
): number {
	const haystack = `${section.title}\n${section.text}`.toLowerCase();
	let score = 0;

	for (const token of queryTokens) {
		if (section.title.toLowerCase().includes(token)) score += 8;
		if (section.keywords.some((keyword) => keyword.includes(token))) score += 5;
		if (haystack.includes(token)) score += 2;
	}

	if (section.kind === 'current') score += 12;
	if (section.kind === 'record') score += 4;
	if (
		section.kind === 'help' &&
		queryTokens.some((token) =>
			['how', 'use', 'where', 'what', 'create', 'start', 'review', 'import'].includes(token)
		)
	) {
		score += 3;
	}
	if (
		section.kind === 'schema' &&
		queryTokens.some((token) =>
			['schema', 'structure', 'related', 'relation', 'database', 'table', 'field'].includes(token)
		)
	) {
		score += 5;
	}
	if (section.route && pathname === section.route) score += 6;
	if (projectId && section.route?.includes(projectId)) score += 7;
	if (assetId && section.route?.includes(assetId)) score += 7;
	return score;
}

function createWorkspaceOverviewSection(params: {
	workspaceProfile: WorkspaceProfile | null;
	projectCount: number;
	activeProjectCount: number;
	contactCount: number;
	materialsCount: number;
	labourRateCount: number;
	equipmentRateCount: number;
	subcontractRateCount: number;
	costPresetCount: number;
	estimateTemplateCount: number;
	classificationCount: number;
	projectStructureTemplateCount: number;
}): LocalAssistantContextSection {
	const businessName =
		params.workspaceProfile?.businessName?.trim() ||
		params.workspaceProfile?.displayName?.trim() ||
		'this workspace';

	return {
		id: 'workspace-overview',
		title: 'Workspace overview',
		kind: 'overview',
		text: [
			`Workspace: ${businessName}.`,
			`Projects: ${params.projectCount} total, ${params.activeProjectCount} active.`,
			`Contacts: ${params.contactCount}.`,
			`Materials: ${params.materialsCount}. Labour rates: ${params.labourRateCount}. Equipment rates: ${params.equipmentRateCount}. Subcontract rates: ${params.subcontractRateCount}.`,
			`Cost presets: ${params.costPresetCount}. Estimate templates: ${params.estimateTemplateCount}. Classification systems: ${params.classificationCount}. Project structure templates: ${params.projectStructureTemplateCount}.`
		].join('\n'),
		summary: `Workspace overview for ${businessName}.`,
		keywords: ['workspace', 'overview', 'counts', 'materials', 'templates', 'rates']
	};
}

function createViewportContextSection(
	viewportContext: LocalAssistantViewportContext | null
): LocalAssistantContextSection | null {
	if (!viewportContext) return null;
	return {
		id: 'current-page-context',
		title: `Current page: ${viewportContext.pageTitle}`,
		kind: 'current',
		text: [
			'Current page context is attached by the user.',
			`Page title: ${viewportContext.pageTitle}.`,
			`Path: ${viewportContext.pathname}.`,
			viewportContext.text ? `Page summary:\n${viewportContext.text}` : null
		]
			.filter(Boolean)
			.join('\n'),
		summary: `Attached page context for ${viewportContext.pageTitle}.`,
		keywords: buildKeywords('current page', viewportContext.pageTitle, viewportContext.pathname),
		route: viewportContext.pathname,
		routeLabel: viewportContext.pageTitle
	};
}

function createKnowledgeSections(
	knowledgeContext: AiWorkspaceKnowledgeContext | null
): LocalAssistantContextSection[] {
	if (!knowledgeContext) return [];
	const sections: LocalAssistantContextSection[] = [];
	pushSection(
		sections,
		knowledgeContext.playbookText
			? {
					id: 'workspace-knowledge-playbook',
					title: 'Workspace AI playbook',
					kind: 'knowledge',
					text: knowledgeContext.playbookText,
					summary: 'Workspace-specific AI guidance.',
					keywords: buildKeywords('workspace knowledge playbook', knowledgeContext.playbookText)
				}
			: null
	);
	for (const file of knowledgeContext.files.slice(0, 4)) {
		pushSection(
			sections,
			file.excerpt
				? {
						id: `workspace-knowledge-file-${file.id}`,
						title: `Knowledge file: ${file.originalName}`,
						kind: 'knowledge',
						text: `File: ${file.originalName}.\nExcerpt:\n${file.excerpt}`,
						summary: `Knowledge excerpt from ${file.originalName}.`,
						keywords: buildKeywords('workspace knowledge file', file.originalName, file.excerpt)
					}
				: null
		);
	}
	return sections;
}

export async function buildLocalAssistantContext(
	request: LocalAssistantContextRequest
): Promise<LocalAssistantContextSection[]> {
	const [projects, counts] = await Promise.all([
		dbService.getProjects(),
		dbService.getWorkspaceOverviewCounts()
	]);

	const sections: LocalAssistantContextSection[] = [
		...getLocalAssistantHelpSections(),
		...createKnowledgeSections(request.knowledgeContext)
	];

	// Optional FTS5 RAG page chunks search across project files
	if (request.projectId && request.query?.trim()) {
		try {
			const sanitizedQuery = request.query
				.toLowerCase()
				.replace(/[^a-z0-9]/g, ' ')
				.split(/\s+/)
				.filter(
					(w) =>
						w.length >= 3 && w !== 'and' && w !== 'the' && w !== 'for' && w !== 'with' && w !== 'or'
				)
				.slice(0, 15)
				.map((w) => `"${w}"`)
				.join(' OR ');

			if (sanitizedQuery) {
				const matchingChunks = await dbService.searchProjectPageChunks(
					request.projectId,
					sanitizedQuery,
					4
				);
				for (const chunk of matchingChunks) {
					sections.push({
						id: `project-file-chunk-${chunk.file_id}-p${chunk.page_number}`,
						title: `Document Page: ${chunk.file_name} (Page ${chunk.page_number})`,
						kind: 'knowledge',
						text: `Document: ${chunk.file_name} (Page ${chunk.page_number}).\nExcerpt:\n${chunk.text_content}`,
						summary: `Relevant specification details from ${chunk.file_name} page ${chunk.page_number}.`,
						keywords: [chunk.file_name.toLowerCase(), `page-${chunk.page_number}`, 'specification']
					});
				}
			}
		} catch (err) {
			log.error(`Failed to retrieve project page chunks for assistant context: ${err}`);
		}
	}

	sections.push(
		createWorkspaceOverviewSection({
			workspaceProfile: request.workspaceProfile,
			projectCount: counts.projectCount,
			activeProjectCount: counts.activeProjectCount,
			contactCount: counts.contactCount,
			materialsCount: counts.materialsCount,
			labourRateCount: counts.labourRateCount,
			equipmentRateCount: counts.equipmentRateCount,
			subcontractRateCount: counts.subcontractRateCount,
			costPresetCount: counts.costPresetCount,
			estimateTemplateCount: counts.estimateTemplateCount,
			classificationCount: counts.classificationCount,
			projectStructureTemplateCount: counts.projectStructureTemplateCount
		})
	);
	pushSection(sections, createViewportContextSection(request.viewportContext));

	const currentProject = request.projectId
		? await dbService.getProjectById(request.projectId)
		: null;
	const currentAssets = currentProject
		? await dbService.getAssetsForProject(currentProject.id)
		: [];
	const usingLiveEstimateContext =
		request.assetId !== null && request.currentEstimateContext?.assetId === request.assetId;
	const currentEstimate = usingLiveEstimateContext
		? request.currentEstimateContext
		: request.assetId
			? await dbService.getEstimate(request.assetId)
			: null;

	if (currentProject) {
		pushSection(sections, {
			id: `project-current-${currentProject.id}`,
			title: `Current RFQ ${currentProject.rfq_number}`,
			kind: 'current',
			text: [
				`RFQ: ${currentProject.rfq_number}.`,
				currentProject.project_name ? `Project name: ${currentProject.project_name}.` : null,
				`Status: ${currentProject.status}.`,
				currentProject.submission_deadline_at || currentProject.due_date
					? `Submission deadline: ${currentProject.submission_deadline_at || currentProject.due_date}.`
					: null,
				getProjectCompanyDisplayName(currentProject)
					? `Company: ${getProjectCompanyDisplayName(currentProject)}.`
					: null,
				getProjectRequesterDisplayName(currentProject)
					? `Requester: ${getProjectRequesterDisplayName(currentProject)}.`
					: null,
				currentProject.note ? `Estimator note: ${excerpt(currentProject.note, 400)}` : null,
				`Assets in this RFQ: ${currentAssets.length}.`
			]
				.filter(Boolean)
				.join('\n'),
			summary: `Current RFQ ${currentProject.rfq_number}.`,
			keywords: buildKeywords(
				'current rfq',
				currentProject.rfq_number,
				currentProject.project_name,
				currentProject.status,
				getProjectCompanyDisplayName(currentProject),
				getProjectRequesterDisplayName(currentProject)
			),
			route: `/project/${currentProject.id}`,
			routeLabel: currentProject.rfq_number
		});

		for (const asset of currentAssets) {
			pushSection(sections, {
				id: `asset-${asset.id}`,
				title: `Asset ${asset.display_name}`,
				kind: asset.id === request.assetId ? 'current' : 'record',
				text: [
					`Asset: ${asset.display_name}.`,
					`Files linked: ${asset.files?.length ?? 0}.`,
					typeof asset.quote_quantity === 'number'
						? `Quote quantity: ${asset.quote_quantity}.`
						: null,
					asset.is_pdf_included ? 'Included in quote PDF.' : 'Not included in quote PDF.'
				]
					.filter(Boolean)
					.join('\n'),
				summary: `Asset ${asset.display_name}.`,
				keywords: buildKeywords('asset', asset.display_name, currentProject.rfq_number),
				route: `/project/${currentProject.id}/asset/${asset.id}`,
				routeLabel: asset.display_name
			});
		}

		if (request.assetId && currentEstimate) {
			const estimateScopeSummary =
				'scopeSummary' in currentEstimate
					? currentEstimate.scopeSummary
					: currentEstimate.scope_summary;

			pushSection(sections, {
				id: `estimate-${request.assetId}`,
				title: 'Current asset estimate',
				kind: 'current',
				text: [
					`Takeoff items: ${'takeoffItemCount' in currentEstimate ? currentEstimate.takeoffItemCount : currentEstimate.takeoff_items.length}.`,
					'quote_quantity' in currentEstimate && typeof currentEstimate.quote_quantity === 'number'
						? `Quote quantity: ${currentEstimate.quote_quantity}.`
						: null,
					'totalCost' in currentEstimate && Number.isFinite(currentEstimate.totalCost)
						? `Total estimate cost: ${currentEstimate.totalCost.toFixed(2)}.`
						: null,
					estimateScopeSummary
						? `Scope summary: ${excerpt(estimateScopeSummary, 500)}`
						: 'Scope summary is empty.',
					currentEstimate.notes ? `Estimate notes: ${excerpt(currentEstimate.notes, 400)}` : null
				]
					.filter(Boolean)
					.join('\n'),
				summary: usingLiveEstimateContext
					? 'Live estimate editor context for the current asset.'
					: 'Saved estimate context for the current asset.',
				keywords: buildKeywords(
					'estimate',
					'scope',
					currentProject.rfq_number,
					currentAssets.find((asset) => asset.id === request.assetId)?.display_name
				),
				route: `/project/${currentProject.id}/asset/${request.assetId}`,
				routeLabel:
					currentAssets.find((asset) => asset.id === request.assetId)?.display_name ??
					'Current asset'
			});
		}
	}

	for (const project of projects) {
		pushSection(sections, {
			id: `project-${project.id}`,
			title: `RFQ ${project.rfq_number}`,
			kind: currentProject?.id === project.id ? 'current' : 'record',
			text: [
				`RFQ: ${project.rfq_number}.`,
				project.project_name ? `Project name: ${project.project_name}.` : null,
				`Status: ${project.status}.`,
				project.submission_deadline_at || project.due_date
					? `Submission deadline: ${project.submission_deadline_at || project.due_date}.`
					: null,
				getProjectCompanyDisplayName(project)
					? `Company: ${getProjectCompanyDisplayName(project)}.`
					: null,
				getProjectRequesterDisplayName(project)
					? `Requester: ${getProjectRequesterDisplayName(project)}.`
					: null
			]
				.filter(Boolean)
				.join('\n'),
			summary: `${project.rfq_number}${project.project_name ? ` · ${project.project_name}` : ''}`,
			keywords: buildKeywords(
				'rfq',
				project.rfq_number,
				project.project_name,
				project.status,
				getProjectCompanyDisplayName(project),
				getProjectRequesterDisplayName(project)
			),
			route: `/project/${project.id}`,
			routeLabel: project.rfq_number
		});
	}

	return sections;
}

export function selectLocalAssistantContextSections(params: {
	sections: LocalAssistantContextSection[];
	query: string;
	pathname: string;
	projectId: string | null;
	assetId: string | null;
	maxSections?: number;
}): LocalAssistantContextSection[] {
	const queryTokens = buildKeywords(params.query);
	const ranked = params.sections
		.map((section) => ({
			section,
			score: scoreSection(section, queryTokens, params.pathname, params.projectId, params.assetId)
		}))
		.filter(
			({ score, section }) => score > 0 || section.kind === 'current' || section.kind === 'overview'
		)
		.sort(
			(left, right) =>
				right.score - left.score || left.section.title.localeCompare(right.section.title)
		)
		.slice(0, params.maxSections ?? MAX_QUERY_SECTION_COUNT)
		.map(({ section }) => section);

	const currentSections = ranked.filter((section) => section.kind === 'current');
	const topSections = ranked.filter((section) => section.kind !== 'current');
	return [...currentSections, ...topSections].slice(
		0,
		params.maxSections ?? MAX_QUERY_SECTION_COUNT
	);
}

export function buildLocalAssistantLinkMap(
	sections: LocalAssistantContextSection[]
): Map<string, AppShellHref> {
	const linkMap = new Map<string, AppShellHref>();
	for (const section of sections) {
		const route = asRoute(section.route ?? null);
		if (route) {
			linkMap.set(section.id, route);
		}
	}
	return linkMap;
}

export function getDatabaseSchemaPromptContext(tableNames?: string[]): string {
	const lines = [
		'[DATABASE SCHEMA INFO]',
		'The following tables and columns are available in SQLite:'
	];
	if (tableNames && tableNames.length === 0) {
		return '';
	}
	const targetTables = tableNames ?? Object.keys(WORKSPACE_RUNTIME_SCHEMA.columns);
	for (const table of targetTables) {
		const columns =
			WORKSPACE_RUNTIME_SCHEMA.columns[table as keyof typeof WORKSPACE_RUNTIME_SCHEMA.columns];
		if (columns) {
			lines.push(`- Table "${table}": Columns [${(columns as readonly string[]).join(', ')}]`);
		}
	}
	return lines.join('\n');
}
