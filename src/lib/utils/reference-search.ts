function trimmedValue(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

function normaliseReferenceVocabulary(value: string): string {
	return value
		.replace(/\blabour\b/g, 'labor')
		.replace(/\bcatalogue\b/g, 'catalog')
		.replace(/\bmetres\b/g, 'meters')
		.replace(/\bmetre\b/g, 'meter');
}

const TRAILING_REFERENCE_QUANTITY_HINT_RE =
	/\s*(?:[:;,.()\-–/]+)?\s*\d+(?:\.\d+)?\s+[a-z0-9][a-z0-9\s/().-]*(?:\s+for\s+\d+(?:\.\d+)?\s+[a-z0-9][a-z0-9\s/().-]*)?$/i;

export function stripTrailingReferenceQuantityHint(value: string | null | undefined): string {
	const trimmed = trimmedValue(value);
	if (!trimmed) return '';
	return trimmed.replace(TRAILING_REFERENCE_QUANTITY_HINT_RE, '').trim();
}

export function normaliseReferenceSearchText(value: string | null | undefined): string {
	const trimmed = stripTrailingReferenceQuantityHint(value);
	if (!trimmed) return '';
	return normaliseReferenceVocabulary(trimmed.toLowerCase())
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function referenceTokenForms(token: string): string[] {
	const forms = new Set<string>();
	const queue = [token];
	const visited = new Set<string>();

	const push = (value: string | null | undefined) => {
		const nextValue = value?.trim();
		if (!nextValue || nextValue.length < 4) return;
		if (!forms.has(nextValue)) {
			forms.add(nextValue);
		}
		if (!visited.has(nextValue)) {
			queue.push(nextValue);
		}
	};

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		push(current);

		if (current.endsWith('ies') && current.length > 4) {
			push(`${current.slice(0, -3)}y`);
		}
		if (current.endsWith('s') && current.length > 4) {
			push(current.slice(0, -1));
		}
		if (current.endsWith('ers') && current.length > 5) {
			push(current.slice(0, -3));
		}
		if (current.endsWith('er') && current.length > 4) {
			push(current.slice(0, -2));
		}
		if (current.endsWith('ing') && current.length > 5) {
			push(current.slice(0, -3));
		}
		if (current.endsWith('ation') && current.length > 7) {
			push(current.slice(0, -3));
			push(current.slice(0, -5));
		}
		if (current.endsWith('ion') && current.length > 6) {
			push(current.slice(0, -3));
		}
		if (current.endsWith('or') && current.length > 4) {
			push(current.slice(0, -2));
		}
	}

	return [...forms];
}

export function buildReferenceSearchTerms(value: string | null | undefined): string[] {
	const normalised = normaliseReferenceSearchText(value);
	if (!normalised) return [];

	return [
		...new Set(
			normalised
				.split(' ')
				.flatMap((token) => referenceTokenForms(token))
				.filter((token) => token.length > 0)
		)
	];
}
