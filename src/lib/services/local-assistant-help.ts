import type { LocalAssistantContextSection } from '$lib/types/index.js';

type HelpSectionKind = Extract<LocalAssistantContextSection['kind'], 'help' | 'schema'>;

type ParsedHelpFrontmatter = {
	id: string;
	title: string;
	kind: HelpSectionKind;
	summary: string;
	keywords: string[];
	route: string | null;
	routeLabel: string | null;
};

const RAW_HELP_FILES = import.meta.glob('../../../content/local-assistant/**/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

function parseFrontmatterValue(value: string): string {
	return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseHelpFrontmatter(
	source: string,
	filePath: string
): {
	frontmatter: ParsedHelpFrontmatter;
	body: string;
} {
	const normalised = source.replace(/\r\n/g, '\n');
	if (!normalised.startsWith('---\n')) {
		throw new Error(`Local assistant help file is missing frontmatter: ${filePath}`);
	}

	const closingIndex = normalised.indexOf('\n---\n', 4);
	if (closingIndex === -1) {
		throw new Error(`Local assistant help file has invalid frontmatter: ${filePath}`);
	}

	const rawFrontmatter = normalised.slice(4, closingIndex).trim();
	const body = normalised.slice(closingIndex + 5).trim();
	const values = new Map<string, string>();

	for (const line of rawFrontmatter.split('\n')) {
		const separatorIndex = line.indexOf(':');
		if (separatorIndex <= 0) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		values.set(key, parseFrontmatterValue(value));
	}

	const id = values.get('id') ?? '';
	const title = values.get('title') ?? '';
	const kind = values.get('kind') as HelpSectionKind | undefined;
	const summary = values.get('summary') ?? '';
	const keywords = (values.get('keywords') ?? '')
		.split(',')
		.map((keyword) => keyword.trim())
		.filter(Boolean);
	const route = values.get('route')?.trim() || null;
	const routeLabel = values.get('routeLabel')?.trim() || null;

	if (!id || !title || !summary || keywords.length === 0 || !kind) {
		throw new Error(`Local assistant help file is missing required fields: ${filePath}`);
	}

	if (kind !== 'help' && kind !== 'schema') {
		throw new Error(`Local assistant help file has unsupported kind "${kind}": ${filePath}`);
	}

	return {
		frontmatter: {
			id,
			title,
			kind,
			summary,
			keywords,
			route,
			routeLabel
		},
		body
	};
}

function markdownToPlainText(markdown: string): string {
	return markdown
		.replace(/\r\n/g, '\n')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^>\s?/gm, '')
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/^\s*[-*]\s+/gm, '- ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function buildLocalAssistantHelpSectionsFromFiles(
	rawFiles: Record<string, string>
): LocalAssistantContextSection[] {
	const seenIds = new Set<string>();

	return Object.entries(rawFiles)
		.sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
		.map(([filePath, source]) => {
			const { frontmatter, body } = parseHelpFrontmatter(source, filePath);
			if (seenIds.has(frontmatter.id)) {
				throw new Error(`Duplicate local assistant help id "${frontmatter.id}": ${filePath}`);
			}
			seenIds.add(frontmatter.id);

			const text = markdownToPlainText(body);
			if (!text) {
				throw new Error(`Local assistant help file has an empty body: ${filePath}`);
			}

			if (frontmatter.route && !frontmatter.route.startsWith('/')) {
				throw new Error(`Local assistant help file route must start with "/": ${filePath}`);
			}

			return {
				id: frontmatter.id,
				title: frontmatter.title,
				kind: frontmatter.kind,
				summary: frontmatter.summary,
				keywords: frontmatter.keywords,
				text,
				route: frontmatter.route,
				routeLabel: frontmatter.routeLabel
			};
		});
}

const HELP_SECTIONS: LocalAssistantContextSection[] = buildLocalAssistantHelpSectionsFromFiles(
	Object.fromEntries(
		Object.entries(RAW_HELP_FILES).filter(([filePath]) => !filePath.endsWith('/README.md'))
	)
);

export function getLocalAssistantHelpSections(): LocalAssistantContextSection[] {
	return HELP_SECTIONS.map((section) => ({
		...section,
		keywords: [...section.keywords]
	}));
}
