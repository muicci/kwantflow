const INTERNAL_WORKSPACE_NAME_PLACEHOLDERS = new Set([
	'Default',
	'Workspace',
	'Kwantflow Workspace'
]);

export function isWorkspaceNamePlaceholder(value: string | null | undefined): boolean {
	const candidate = value?.trim() ?? '';
	return !!candidate && INTERNAL_WORKSPACE_NAME_PLACEHOLDERS.has(candidate);
}

export function sanitiseBusinessNameCandidate(
	value: string | null | undefined,
	displayName?: string | null | undefined
): string {
	const candidate = value?.trim() ?? '';
	if (!candidate) return '';

	const relatedDisplayName = displayName?.trim() ?? '';
	if (
		isWorkspaceNamePlaceholder(candidate) &&
		(!relatedDisplayName || isWorkspaceNamePlaceholder(relatedDisplayName))
	) {
		return '';
	}

	return candidate;
}

export function slugifyWorkspaceName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
}

export function buildUniqueWorkspaceSlug(
	baseSlug: string,
	existingEntries: Array<{ slug: string }>
): string {
	const fallbackSlug = baseSlug || 'workspace';
	const existingSlugs = new Set(existingEntries.map((entry) => entry.slug));
	if (!existingSlugs.has(fallbackSlug)) return fallbackSlug;
	for (let index = 2; index <= 100; index += 1) {
		const candidate = `${fallbackSlug}-${index}`;
		if (!existingSlugs.has(candidate)) return candidate;
	}
	return `${fallbackSlug}-${crypto.randomUUID().slice(0, 8)}`;
}
